import asyncio
import copy
import csv
import json
from pathlib import Path

import httpx
import pytest
import pytest_asyncio

from app.catalog import import_catalog
from app.config import Settings
from app.main import create_app


def product(pid, name, category, unit, amount, claim=False):
    return {"id": pid, "deleted": False, "salesUnit": "ST", "baseUnit": "ST", "category": category, "allowedLotSize": 1, "units": [{"unitId": "ST", "sizeInBaseUnits": 1}], "synkkaData": {"names": [{"language": "en", "value": name}], "classifications": [{"name": "nutritionalClaim", "type": "ENUM", "values": [{"id": "FREE_FROM_LACTOSE", "unit": "FREE_FROM"}] if claim else []}], "unitConversions": [{"synkkaPackagingType": "BASE_UNIT_OR_EACH", "volume": {"unit": unit, "value": amount}, "netWeight": {"unit": "GRM", "value": 1000 if unit == "LTR" else amount}}]}}


@pytest.fixture
def settings(tmp_path):
    products = [product(pid, f"Test lactose free milk {pid}", "10400", "LTR", 1, True) for pid in ["464201", "464398", "463335", "464440"]]
    products += [product(pid, f"Test rolled oats {pid}", "21370", "GRM", 1000) for pid in ["461179", "460200", "463088", "461577"]]
    (tmp_path / "valio_aimo_junction26_product_data.json").write_text(json.dumps(products))
    for filename, column in [("delivery_reliability", "deliveryReliability"), ("carbon_footprint", "AVG kg CO2-eq/kg")]:
        with (tmp_path / f"valio_aimo_junction26_{filename}.csv").open("w") as f:
            writer = csv.writer(f)
            writer.writerow(["productId", column])
            writer.writerow(["464201", "0.98"])
    import_catalog(tmp_path, tmp_path / "catalog.db")
    return Settings(database_url=f"sqlite:///{tmp_path}/test.db", catalog_path=tmp_path / "catalog.db", aimo_mode="fixture", _env_file=None)


@pytest_asyncio.fixture
async def context(settings):
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            await client.get("/api/v1/session")
            yield app, client


async def finish(app):
    await asyncio.gather(*list(app.state.workflow.tasks.values()))


async def submit(app, client, body=None, key="test-request-key"):
    response = await client.post("/api/v1/requests", json=body or {"preset": "routine"}, headers={"Idempotency-Key": key})
    assert response.status_code == 202, response.text
    await finish(app)
    return (await client.get("/api/v1/requests/" + response.json()["id"])).json()


async def decision(client, state, action="approve"):
    return await client.post(f"/api/v1/approvals/{state['id']}/decision", json={"decision": action, "fingerprint": state["preview"]["fingerprint"]})
