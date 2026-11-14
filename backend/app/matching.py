import hashlib
import json
from datetime import date
from decimal import Decimal, ROUND_CEILING

from .catalog import canonical_per_sales, dec, group_matches, requirement_evidence
from .providers import parse_time
from .schemas import BasketLine, Offer, Policy, now


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def build_offer(product: dict, line: BasketLine, price: dict, stock: dict, source: str, needed_by: date, policy: Policy) -> Offer:
    reasons, evidence = [], requirement_evidence(product)
    if product.get("synkkaData", {}).get("variableUnit"):
        reasons.append("Variable-weight products need a verified final quantity before ordering.")
    if product.get("deposits"):
        reasons.append("Deposit charges are not fully priced by this basket. Choose a product without unverified charges.")
    factor = canonical_per_sales(product, line.unit)
    quantity = Decimal(0)
    if factor:
        lot = dec(product["allowedLotSize"])
        # Physical packages remain whole even if the synthetic step permits .01.
        if product["salesUnit"] not in {"KG", "KGM", "L", "LTR"}:
            lot = max(lot, Decimal(1))
        if lot <= 0:
            reasons.append("The catalog has an invalid order increment.")
        else:
            quantity = (line.quantity / factor / lot).to_integral_value(rounding=ROUND_CEILING) * lot
            if quantity * factor != line.quantity:
                reasons.append(f"Pack rounding would deliver {quantity * factor:g} {line.unit}; confirm a revised quantity.")
    else:
        reasons.append(f"No reliable catalog conversion to {line.unit}.")
    required = set(line.requirements)
    for rule in policy.attribute_rules:
        if group_matches(rule.group, product):
            required.add(rule.attribute)
    for attribute in required:
        if attribute not in evidence:
            reasons.append(f"No explicit {attribute.replace('_', '-')} evidence in the catalog.")
    unit_price = Decimal(0)
    expiry = []
    if price.get("_pricingDate") and price["_pricingDate"][:10] != needed_by.isoformat():
        reasons.append("The price API returned a different pricing date.")
    if stock.get("_requestedDate") and stock["_requestedDate"][:10] != needed_by.isoformat():
        reasons.append("The availability API returned a different requested date.")
    if price.get("error", True):
        reasons.append("No valid price returned by the price API.")
    else:
        quoted = price.get("priceWithTax") or {}
        value = quoted.get("value")
        if value is None:
            value = (price.get("catalogPrice") or {}).get("valueWithTax")
            quoted = price.get("catalogPrice") or {}
        if value is None or dec(value) < 0 or dec(price.get("quantity", 0)) != 1:
            reasons.append("A tax-inclusive price per sales unit is missing.")
        else:
            unit_price = dec(value)
        if quoted.get("currency", price.get("_currency")) != "EUR":
            reasons.append("Only EUR price evidence is supported for this demo.")
        start, end = parse_time(quoted.get("validFrom")), parse_time(quoted.get("validTo"))
        if not start or not end:
            reasons.append("The price validity period is unknown.")
        else:
            # The upstream period applies to the requested pricing/delivery date.
            if not start.date() <= needed_by <= end.date():
                reasons.append("Price is not valid for the requested delivery date.")
            if end <= now():
                reasons.append("The quoted price has expired.")
            expiry.append(end)
    schedule = stock.get("scheduleLines") or []
    if stock.get("salesBlock", True):
        reasons.append("The product is blocked from ordering.")
    if not schedule:
        reasons.append("No delivery availability was returned.")
    else:
        s = schedule[0]
        if s.get("salesBlock", True):
            reasons.append("The delivery line is blocked from ordering.")
        if s.get("salesUnit") != product["salesUnit"]:
            reasons.append("Availability uses an unverified sales unit.")
        available_date = parse_time(s.get("availableDate"))
        if not available_date:
            reasons.append("The delivery date is unknown.")
        elif available_date.date() > needed_by:
            reasons.append(f"Earliest delivery is {available_date.date()}, after the requested date.")
        amount = dec(s.get("availableAmount", 0))
        logistic_model = str(stock.get("logisticModel", "")).lower()
        if "terminal" in logistic_model or amount == 999999:
            reasons.append("Terminal stock quantity is unknown; it cannot authorize this basket.")
        elif logistic_model != "stock":
            reasons.append("The stock model is unknown.")
        elif amount < quantity:
            reasons.append(f"Only {amount:g} sales units available; {quantity:g} are needed.")
    cutoff = parse_time(stock.get("closingTime"))
    if not cutoff:
        reasons.append("The order cutoff is unknown.")
    elif cutoff <= now():
        reasons.append("The order cutoff has passed.")
    else:
        expiry.append(cutoff)
    signature = hashlib.sha256(json.dumps([product["id"], str(quantity), str(unit_price), needed_by.isoformat(), line.model_dump(mode="json")], sort_keys=True).encode()).hexdigest()[:20]
    return Offer(
        id=signature, product_id=product["id"], name=product["name"], category=product["category"],
        requested=line, sales_quantity=quantity, sales_unit=product["salesUnit"], canonical_quantity=quantity * (factor or 0), unit=line.unit,
        unit_price=unit_price, total=money(unit_price * quantity), currency="EUR", eligible=not reasons, reasons=reasons,
        requirement_evidence=evidence,
        conversion=f"{quantity:f} × {factor:f} {line.unit} = {quantity * factor:f} {line.unit}" if factor else "Conversion unavailable",
        checked_at=now().isoformat(), valid_until=min(expiry).isoformat() if expiry else None, source=source,
        reliability=product.get("reliability"), carbon=product.get("carbon"),
        evidence={"price": price, "availability": stock, "allowed_lot_size": product["allowedLotSize"], "catalog_product_id": product["id"]},
    )


def rank_offers(offers: list[Offer]) -> list[Offer]:
    return sorted(offers, key=lambda o: (not o.eligible, o.total, -(o.reliability if o.reliability is not None else -1), o.product_id))


def check_combined_stock(items: list[Offer]):
    """Repeated basket lines must not each consume the same stock independently."""
    totals = {}
    for item in items:
        totals[item.product_id] = totals.get(item.product_id, Decimal(0)) + item.sales_quantity
    for item in items:
        schedules = item.evidence.get("availability", {}).get("scheduleLines", [])
        if schedules and dec(schedules[0].get("availableAmount", 0)) < totals[item.product_id]:
            item.eligible = False
            reason = f"Combined basket needs {totals[item.product_id]:g} sales units of this product, exceeding available stock."
            if reason not in item.reasons:
                item.reasons.append(reason)
