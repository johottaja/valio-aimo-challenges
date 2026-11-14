import asyncio
import json
from datetime import date, datetime, timedelta
from decimal import Decimal

import httpx

from .catalog import canonical_per_sales
from .config import Settings
from .schemas import now


class UpstreamError(Exception):
    def __init__(self, message="The challenge service could not be reached. Retry when it is available."):
        self.message = message
        super().__init__(message)


class ChallengeProvider:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def quote(self, products: list[dict], needed_by: date) -> tuple[dict, dict, str]:
        mode = self.settings.aimo_mode
        if mode == "fixture":
            return self.fixtures(products, needed_by)
        ids = [p["id"] for p in products]
        body = {"customer": "demo-hotel-helsinki", "requestedDate": needed_by.isoformat(), "products": ids}
        if mode == "replay":
            try:
                recording = json.loads(self.settings.replay_path.read_text())
                if recording["requestedDate"] != needed_by.isoformat():
                    raise UpstreamError("The recording is for a different delivery date. Use live mode or record this date.")
                prices = {p["productId"]: p for p in recording["price"]["products"]}
                stock = {p["productId"]: p for p in recording["availability"]["products"]}
                if not all(i in prices and i in stock for i in ids):
                    raise UpstreamError("The recording does not contain these products. No live fallback was attempted.")
                return prices, stock, f"Recorded challenge APIs · {recording['recorded_at']}"
            except (OSError, KeyError, ValueError) as exc:
                raise UpstreamError("No valid challenge recording is configured.") from exc
        if not self.settings.aimo_api_key:
            raise UpstreamError("Add AIMO_API_KEY on the server to check live prices and availability. No order has been placed.")
        try:
            async with httpx.AsyncClient(timeout=15, headers={"X-API-Key": self.settings.aimo_api_key}, base_url=self.settings.aimo_base_url) as client:
                responses = await asyncio.gather(client.post("/api/price", json=body), client.post("/api/availability", json=body))
                for response in responses:
                    response.raise_for_status()
                price, stock = [r.json() for r in responses]
            # Preserve top-level timestamps on each normalized evidence entry.
            return ({p["productId"]: {**p, "_currency": price["currency"], "_pricingDate": price["pricingDate"]} for p in price["products"]},
                    {p["productId"]: {**p, "_timeNow": stock["timeNow"], "_requestedDate": stock["requestedDate"]} for p in stock["products"]}, "Live challenge APIs")
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            raise UpstreamError("Challenge API credentials were rejected." if status in (401, 403) else "The challenge API is rate limited. Try again shortly." if status == 429 else "The challenge API returned an error. No order has been placed.") from exc
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            raise UpstreamError() from exc

    def fixtures(self, products: list[dict], needed_by: date):
        """Invented, explicitly labeled values. Never returned from live mode."""
        prices, stock = {}, {}
        for product in sorted(products, key=lambda p: p["id"]):
            index = int(product["id"]) % 5
            amount = canonical_per_sales(product, "L") or canonical_per_sales(product, "kg") or Decimal(1)
            unit_price = ((Decimal("1.20") + Decimal(index % 5) / 10) * amount).quantize(Decimal("0.01"))
            price = {"value": str(unit_price), "currency": "EUR", "validFrom": now().isoformat(), "validTo": needed_by.isoformat() + "T23:59:59+02:00"}
            prices[product["id"]] = {"productId": product["id"], "quantity": 1, "priceWithTax": price, "catalogPrice": {**price, "valueWithTax": str(unit_price)}, "tax": {"taxRate": 13.5, "taxValue": "0"}, "error": False, "netPriceFound": False}
            stock[product["id"]] = {"productId": product["id"], "salesBlock": False, "logisticModel": "Stock", "closingTime": (now() + timedelta(hours=1)).isoformat(), "scheduleLines": [{"availableAmount": 50000, "salesUnit": product["salesUnit"], "availableDate": needed_by.isoformat(), "salesBlock": False}]}
        return prices, stock, "Simulated prices & stock · actual challenge catalog"


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            from zoneinfo import ZoneInfo
            result = result.replace(tzinfo=ZoneInfo("Europe/Helsinki"))
        return result
    except ValueError:
        return None
