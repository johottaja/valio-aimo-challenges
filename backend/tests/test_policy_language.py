import json
import sqlite3
from decimal import Decimal

import pytest

from app.agents import AgentError, interpret_policy
from app.catalog import Catalog, group_matches
from app.policy import evaluate
from app.matching import build_offer
from app.providers import ChallengeProvider
from app.schemas import AttributeRule, BasketLine, BasketPreview, Policy, PolicyTextInput, QuantityRule, next_monday
from conftest import product, submit
from test_agents import FakeClient


def add_cheese(settings):
    with sqlite3.connect(settings.catalog_path) as conn:
        for code in ("10600", "10602"):
            item = product("700" + code, "Juusto Cheese " + code, code, "GRM", 1000)
            item["name"] = "Juusto Cheese " + code
            conn.execute("INSERT INTO products VALUES (?, ?)", (item["id"], json.dumps(item)))


def test_categories_include_groups_outside_demo(settings):
    add_cheese(settings)
    categories = Catalog(settings.catalog_path).categories()
    assert {c["code"] for c in categories} == {"10400", "21370", "10600", "10602"}
    assert next(c for c in categories if c["code"] == "10600")["examples"] == ["Juusto Cheese 10600"]


@pytest.mark.parametrize("delivery_location", [None, "main-kitchen"])
async def test_compile_review_save_is_customer_controlled(context, settings, monkeypatch, delivery_location):
    _, client = context
    add_cheese(settings)
    settings.gemini_api_key = "test-key-not-a-real-secret"
    output = {"quantity_rules": [{"group": "juustot", "category_codes": ["10600", "10602"], "limit": "100", "unit": "kg", "scope": "delivery"}],
              "attribute_rules": [{"group": "juustot", "category_codes": ["10600", "10602"], "attribute": "lactose_free"}],
              "location": delivery_location, "clarification": None, "spend_limit": "999999"}

    class PolicyClient(FakeClient):
        async def generate_content(self, **kwargs):
            codes = {c["code"] for c in json.loads(kwargs["contents"])["catalog_categories"]}
            assert {"10600", "10602"}.issubset(codes)
            return await super().generate_content(**kwargs)

    monkeypatch.setattr("app.agents.genai.Client", lambda **kw: PolicyClient(json.dumps(output)))
    before = (await client.get("/api/v1/policy")).json()
    text = "Juustoja yhteensä 100 kg ilman hyväksyntää. Juustojen pitää olla laktoosittomia."
    if delivery_location:
        text += f" Deliver only to {delivery_location}."
    payload = {"text": text, "version": before["version"], "spend_limit": "250.50"}
    response = await client.post("/api/v1/policy/interpret", json=payload)
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["rules_text"] == text
    assert preview["spend_limit"] == "250.50"
    assert preview["location"] == (delivery_location or before["location"])
    assert preview["location_is_explicit"] is (delivery_location is not None)
    assert preview["quantity_rules"][0]["category_codes"] == ["10600", "10602"]
    assert (await client.get("/api/v1/policy")).json() == before
    saved = await client.put("/api/v1/policy", json=preview)
    assert saved.status_code == 200
    assert saved.json()["version"] == before["version"] + 1
    assert saved.json()["rules_text"] == text
    assert (await client.post("/api/v1/policy/interpret", json=payload)).status_code == 409
    preview["version"] = saved.json()["version"]
    preview["quantity_rules"][0]["category_codes"] = ["invented"]
    assert (await client.put("/api/v1/policy", json=preview)).status_code == 422
    await client.post("/api/v1/session/role", json={"role": "aimo"})
    payload["version"] = saved.json()["version"]
    assert (await client.post("/api/v1/policy/interpret", json=payload)).status_code == 403


@pytest.mark.parametrize("codes,limit,clarification", [
    (["10400"], "100", "Organic cannot be enforced; clarify the requirement."),
    (["invented"], "100", None),
    ([], "100", None),
    (["10400"], "-1", None),
])
async def test_invalid_or_unsupported_rules_never_become_policy(settings, monkeypatch, codes, limit, clarification):
    settings.gemini_api_key = "test-key-not-a-real-secret"
    output = {"quantity_rules": [{"group": "milk", "category_codes": codes, "limit": limit, "unit": "L", "scope": "delivery"}],
              "attribute_rules": [], "location": "hotel-helsinki", "clarification": clarification}
    monkeypatch.setattr("app.agents.genai.Client", lambda **kw: FakeClient(json.dumps(output)))
    with pytest.raises(AgentError):
        await interpret_policy(settings, PolicyTextInput(text="Rules", version=1, spend_limit="100"), Policy(), Catalog(settings.catalog_path).categories())


async def test_compiled_limit_combines_every_category(context):
    app, client = context
    state = await submit(app, client)
    preview = BasketPreview.model_validate(state["preview"])
    for item, code in zip(preview.items, ("10600", "10602")):
        item.category, item.canonical_quantity, item.unit = code, Decimal("60"), "kg"
    policy = Policy(quantity_rules=[QuantityRule(group="juustot", category_codes=["10600", "10602"], limit=100, unit="kg")])
    decision = evaluate(policy, preview, [])
    assert decision.outcome == "approval_required"
    assert "120 kg" in decision.reasons[0]
    assert group_matches("juustot", {"category": "10602"}, ["10600", "10602"])
    assert not group_matches("juustot", {"category": "10400"}, ["10600", "10602"])


async def test_compiled_dietary_requirement_blocks_every_covered_category(settings):
    add_cheese(settings)
    catalog = Catalog(settings.catalog_path)
    items = [catalog.get("700" + code) for code in ("10600", "10602")]
    policy = Policy(quantity_rules=[], attribute_rules=[AttributeRule(
        group="juustot", category_codes=["10600", "10602"], attribute="lactose_free")])
    date = next_monday()
    prices, stock, source = await ChallengeProvider(settings).quote(items, date)
    for item in items:
        offer = build_offer(item, BasketLine(description="cheese", quantity=1, unit="kg"),
                            prices[item["id"]], stock[item["id"]], source, date, policy)
        assert not offer.eligible
        assert any("lactose-free" in reason for reason in offer.reasons)


@pytest.mark.parametrize("scope,expected", [("order", "eligible"), ("delivery", "approval_required")])
async def test_order_scope_does_not_count_previous_delivery_orders(context, scope, expected):
    app, client = context
    state = await submit(app, client)
    current = BasketPreview.model_validate(state["preview"])
    current.items = current.items[:1]
    current.items[0].canonical_quantity = Decimal("5")
    prior = current.model_copy(deep=True)
    prior.items[0].canonical_quantity = Decimal("2200")
    policy = Policy(quantity_rules=[QuantityRule(group="milk", limit=10, unit="L", scope=scope)])
    decision = evaluate(policy, current, [prior])
    assert decision.outcome == expected
    if scope == "delivery":
        assert "This basket contains 5 L" in decision.reasons[0]
        assert "2,200 L" in decision.reasons[0]
        assert "2,205 L total" in decision.reasons[0]
