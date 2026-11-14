import asyncio
import copy
from datetime import timedelta
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import select

from app.db import Purchase, Reservation
from app.main import create_app
from app.providers import UpstreamError
from app.schemas import RequestView, now
from conftest import decision, finish, submit


async def test_routine_basket_commits_atomically_and_is_idempotent(context):
    app, client = context
    state = await submit(app, client)
    assert state["status"] == "committed"
    assert len(state["receipt"]["preview"]["items"]) == 2
    assert state["receipt"]["authorization"] == "Ordered automatically"
    again = await submit(app, client)
    assert again["receipt"]["id"] == state["receipt"]["id"]
    assert len((await client.get("/api/v1/orders")).json()) == 1
    conflict = await client.post("/api/v1/requests", json={"preset": "approval"}, headers={"Idempotency-Key": "test-request-key"})
    assert conflict.status_code == 409


async def test_large_basket_pauses_and_duplicate_approval_returns_same_receipt(context):
    app, client = context
    state = await submit(app, client, {"preset": "approval"})
    assert state["status"] == "approval_pending"
    assert "1,500 L" in state["message"]
    assert not (await client.get("/api/v1/orders")).json()
    results = await asyncio.gather(decision(client, state), decision(client, state))
    assert all(r.status_code == 200 for r in results)
    assert len({r.json()["receipt"]["id"] for r in results}) == 1
    assert len((await client.get("/api/v1/orders")).json()) == 1
    assert (await decision(client, state, "reject")).status_code == 409


async def test_rejection_is_terminal(context):
    app, client = context
    state = await submit(app, client, {"preset": "approval"})
    assert (await decision(client, state, "reject")).json()["status"] == "rejected"
    assert (await decision(client, state, "reject")).status_code == 200
    assert (await decision(client, state)).status_code == 409
    assert not (await client.get("/api/v1/orders")).json()


async def test_price_change_requires_fresh_bound_review(context):
    app, client = context
    state = await submit(app, client, {"preset": "approval"})
    provider = app.state.workflow.provider
    original = provider.quote

    async def changed(products, needed_by):
        prices, stocks, source = await original(products, needed_by)
        for price in prices.values():
            price["priceWithTax"]["value"] = str(Decimal(price["priceWithTax"]["value"]) + 1)
        return prices, stocks, source

    provider.quote = changed
    result = (await decision(client, state)).json()
    assert result["status"] == "changed"
    assert result["preview"]["fingerprint"] != state["preview"]["fingerprint"]
    assert not (await client.get("/api/v1/orders")).json()
    assert (await decision(client, state)).status_code == 409
    assert (await decision(client, result)).json()["status"] == "committed"


async def test_stock_change_blocks_all_basket_lines(context):
    app, client = context
    state = await submit(app, client, {"preset": "approval"})
    original = app.state.workflow.provider.quote

    async def unavailable(products, needed_by):
        prices, stocks, source = await original(products, needed_by)
        next(iter(stocks.values()))["salesBlock"] = True
        return prices, stocks, source

    app.state.workflow.provider.quote = unavailable
    result = (await decision(client, state)).json()
    assert result["status"] == "needs_information"
    assert not (await client.get("/api/v1/orders")).json()


async def test_missing_one_product_never_places_partial_basket(context):
    app, client = context
    state = await submit(app, client, {"items": [{"description": "milk", "quantity": 10, "unit": "L"}, {"description": "nonexistentzzzz", "quantity": 1, "unit": "kg"}]})
    assert state["status"] == "needs_information"
    assert state["preview"] is None
    assert not (await client.get("/api/v1/orders")).json()


async def test_clarification_choices_are_returned_and_rechecked(context, monkeypatch):
    app, client = context
    async def suggest(line, products):
        return ["lactose free milk", "whole milk"]
    monkeypatch.setattr(app.state.workflow.matcher, "suggest_choices", suggest)
    state = await submit(app, client, {"items": [{"description": "nonexistentzzzz", "quantity": 10, "unit": "L", "requirements": ["vegan"]}]})
    assert state["clarification_choices"] == [["lactose free milk", "whole milk"]]
    response = await client.post(f"/api/v1/requests/{state['id']}/clarify", json={"items": [{"description": state["clarification_choices"][0][0], "quantity": 10, "unit": "L", "requirements": ["vegan"]}], "needed_by": state["input"]["needed_by"], "location": state["input"]["location"]})
    assert response.status_code == 202
    await finish(app)
    updated = (await client.get("/api/v1/requests/" + state["id"])).json()
    assert updated["items"][0]["description"] == "lactose free milk"
    assert updated["items"][0]["requirements"] == ["vegan"]
    assert updated["status"] == "needs_information"
    assert not (await client.get("/api/v1/orders")).json()


async def test_unknown_requirement_cannot_be_human_approved(context):
    app, client = context
    state = await submit(app, client, {"items": [{"description": "milk", "quantity": 10, "unit": "L", "requirements": ["vegan"]}]})
    assert state["status"] == "needs_information"
    assert all(not o["eligible"] for o in state["alternatives"][0])
    assert any("vegan" in r for o in state["alternatives"][0] for r in o["reasons"])


async def test_split_requests_aggregate_even_when_concurrent(context):
    app, client = context
    original = app.state.workflow.provider.quote

    async def slow(products, needed_by):
        await asyncio.sleep(.01)
        return await original(products, needed_by)

    app.state.workflow.provider.quote = slow
    payload = {"items": [{"description": "milk", "quantity": 600, "unit": "L", "requirements": ["lactose_free"]}]}
    responses = await asyncio.gather(*[client.post("/api/v1/requests", json=payload, headers={"Idempotency-Key": f"concurrent-request-{i}"}) for i in range(2)])
    await finish(app)
    states = [(await client.get("/api/v1/requests/" + r.json()["id"])).json() for r in responses]
    assert sorted(s["status"] for s in states) == ["approval_pending", "committed"]
    assert len((await client.get("/api/v1/orders")).json()) == 1
    with app.state.database.read() as db:
        assert not db.scalars(select(Reservation)).all()


async def test_policy_updates_expire_existing_previews_and_enforce_version(context):
    app, client = context
    state = await submit(app, client, {"preset": "approval"})
    policy = (await client.get("/api/v1/policy")).json()
    policy["spend_limit"] = "500"
    response = await client.put("/api/v1/policy", json=policy)
    assert response.json()["version"] == 2
    assert (await client.put("/api/v1/policy", json=policy)).status_code == 409
    assert (await decision(client, state)).status_code == 409
    refreshed = (await client.get("/api/v1/requests/" + state["id"])).json()
    assert refreshed["status"] == "expired"


async def test_expiry_cannot_be_approved(context):
    app, client = context
    state = await submit(app, client, {"preset": "approval"})
    with app.state.database.write() as db:
        row = db.get(Purchase, state["id"])
        value = RequestView.model_validate_json(row.state)
        value.preview.expires_at = (now() - timedelta(seconds=1)).isoformat()
        row.state = value.model_dump_json()
    assert (await decision(client, state)).status_code == 409
    assert (await client.get("/api/v1/requests/" + state["id"])).json()["status"] == "expired"


async def test_roles_and_cross_sandbox_isolation(context):
    app, client = context
    state = await submit(app, client, {"preset": "approval"})
    await client.post("/api/v1/session/role", json={"role": "aimo"})
    assert (await decision(client, state)).status_code == 403
    assert (await client.post("/api/v1/requests", json={"preset": "routine"}, headers={"Idempotency-Key": "forbidden-key"})).status_code == 403
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as outsider:
        await outsider.get("/api/v1/session")
        assert (await outsider.get("/api/v1/requests/" + state["id"])).status_code == 404
        assert (await decision(outsider, state)).status_code == 404
        assert not (await outsider.get("/api/v1/requests")).json()
        await outsider.post("/api/v1/session/reset")
    assert (await client.get("/api/v1/requests/" + state["id"])).status_code == 200


async def test_upstream_failure_is_explicit_and_retryable(context):
    app, client = context
    original = app.state.workflow.provider.quote

    async def broken(*args):
        raise UpstreamError("Test upstream is unavailable.")

    app.state.workflow.provider.quote = broken
    state = await submit(app, client)
    assert state["status"] == "failed"
    assert not (await client.get("/api/v1/orders")).json()
    app.state.workflow.provider.quote = original
    assert (await client.post(f"/api/v1/requests/{state['id']}/retry")).status_code == 202
    await finish(app)
    assert (await client.get("/api/v1/requests/" + state["id"])).json()["status"] == "committed"


async def test_custom_language_requires_gemini_and_clarification_works(context):
    app, client = context
    state = await submit(app, client, {"text": "Order something for breakfast"})
    assert state["status"] == "needs_information"
    assert "Gemini" in state["message"]
    response = await client.post(f"/api/v1/requests/{state['id']}/clarify", json={"items": [{"description": "milk", "quantity": 10, "unit": "L"}]})
    assert response.status_code == 202
    await finish(app)
    assert (await client.get("/api/v1/requests/" + state["id"])).json()["status"] == "committed"


async def test_natural_language_oats_reaches_a_complete_order(context, monkeypatch):
    from test_agents import FakeClient
    app, client = context
    app.state.workflow.settings.gemini_api_key = "test-key-not-a-real-secret"
    outputs = iter([
        '{"items":[{"description":"rolled oats","quantity":"10","unit":"kg","requirements":[]}],"clarification":null}',
        '{"product_ids":["460200"],"reason":"Rolled oats match the requested product type."}',
    ])
    monkeypatch.setattr("app.agents.genai.Client", lambda **kw: FakeClient(next(outputs)))
    state = await submit(app, client, {"text": "10kg of rolled oats"})
    assert state["status"] == "committed"
    assert state["agent_mode"] == "Gemini"
    items = state["receipt"]["preview"]["items"]
    assert len(items) == 1
    assert Decimal(items[0]["canonical_quantity"]) == 10
    assert items[0]["unit"] == "kg"


async def test_malformed_requests_and_client_authority_rejected(context):
    _, client = context
    for body in [{}, {"preset": "routine", "role": "customer"}, {"items": [{"description": "milk", "quantity": -1, "unit": "L"}]}, {"preset": "routine", "policy_version": 999}]:
        response = await client.post("/api/v1/requests", json=body, headers={"Idempotency-Key": "invalid-body-key"})
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_input"
    response = await client.post("/api/v1/session/reset", headers={"Sec-Fetch-Site": "cross-site"})
    assert response.status_code == 403


async def test_receipt_persists_and_interrupted_jobs_recover(context, settings):
    app, client = context
    state = await submit(app, client)
    cookie = client.cookies.get("aimo_demo")
    interrupted, _ = app.state.workflow.create(next(iter(_sandbox_ids(app))), state_input(), "interrupted-request-key")
    second = create_app(settings)
    async with second.router.lifespan_context(second):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=second), base_url="http://test", cookies={"aimo_demo": cookie}) as restored:
            result = (await restored.get("/api/v1/requests/" + state["id"])).json()
            assert result["receipt"]["id"] == state["receipt"]["id"]
            assert (await restored.get("/api/v1/requests/" + interrupted.id)).json()["status"] == "failed"


def _sandbox_ids(app):
    from app.db import Sandbox
    with app.state.database.read() as db:
        return list(db.scalars(select(Sandbox.id)).all())


def state_input():
    from app.schemas import PurchaseRequest
    return PurchaseRequest(preset="routine")
