"""Read-only challenge catalog. Only structured fields establish requirements/units."""
import argparse
import csv
import json
import re
import sqlite3
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path

CLAIMS = {"FREE_FROM_LACTOSE": "lactose_free", "FREE_FROM_GLUTEN": "gluten_free", "VEGAN": "vegan"}
# Reviewed demo aliases; original category codes remain the authority for grouping.
GROUPS = {"milk": ["10400"], "oats": ["21370"]}
DEMO_IDS = {"milk": ["464201", "464398", "463335", "464440"], "oats": ["461179", "460200", "463088", "461577"]}


def dec(value) -> Decimal:
    return Decimal(str(value))


def measure(value: dict | None, target: str) -> Decimal | None:
    if not value:
        return None
    scales = {"L": {"LTR": 1, "MLT": Decimal("0.001"), "L": 1}, "kg": {"KGM": 1, "GRM": Decimal("0.001"), "KG": 1}}
    factor = scales.get(target, {}).get(value.get("unit"))
    amount = dec(value.get("value", 0))
    return amount * factor if factor is not None and amount > 0 else None


def canonical_per_sales(product: dict, unit: str) -> Decimal | None:
    """Explicit hierarchy only. Never convert gross weight into product volume."""
    if product["salesUnit"] in ({"L", "LTR"} if unit == "L" else {"KG", "KGM"} if unit == "kg" else set()):
        return Decimal(1)
    if product["salesUnit"] == product["baseUnit"]:
        factor = Decimal(1)
    else:
        entry = next((u for u in product.get("units", []) if u["unitId"] == product["salesUnit"]), None)
        if not entry or dec(entry["sizeInBaseUnits"]) <= 0:
            return None
        factor = dec(entry["sizeInBaseUnits"])
    if unit == "pcs":
        # A piece is supported only when the base code explicitly means a piece.
        return factor if product["baseUnit"] == "ST" else None
    base = next((c for c in product.get("synkkaData", {}).get("unitConversions", []) if c.get("synkkaPackagingType") == "BASE_UNIT_OR_EACH"), None)
    if not base:
        return None
    amount = measure(base.get("volume") if unit == "L" else base.get("netWeight"), unit)
    return amount * factor if amount else None


def requirement_evidence(product: dict) -> dict[str, str]:
    found = {}
    for group in product.get("synkkaData", {}).get("classifications", []):
        if group["name"] not in ("nutritionalClaim", "packagingMarkedLabel"):
            continue
        for value in group.get("values", []):
            attr = CLAIMS.get(value.get("id"))
            if attr and (value.get("unit") == "FREE_FROM" or value.get("id") == "VEGAN"):
                found[attr] = f"Catalog {group['name']}: {value['id']}" 
    return found


def group_matches(group: str, product: dict) -> bool:
    group = group.strip().lower()
    return product["category"] in GROUPS.get(group, [group])


class Catalog:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(f"file:{self.path.resolve()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def count(self) -> int:
        if not self.path.exists():
            return 0
        with self.connect() as conn:
            return conn.execute("SELECT count(*) FROM products").fetchone()[0]

    def get(self, product_id: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute("SELECT data FROM products WHERE id=?", (product_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def search(self, query: str, limit: int = 16, reviewed: bool = False) -> list[dict]:
        if not self.count():
            return []
        words = re.findall(r"[\w]+", query.lower())
        kind = "milk" if "milk" in words else "oats" if any(w in words for w in ["oats", "oat", "rolled"]) else None
        if reviewed and kind:
            return [p for pid in DEMO_IDS[kind] if (p := self.get(pid))]
        # Search names, not marketing copy, to reduce incidental matches.
        ignored = {"free", "lactose", "gluten", "vegan", "of", "the", "and", "for", "kg", "litres", "liters"}
        terms = [w for w in words if w not in ignored and not w.isdigit()]
        if not terms:
            return []
        expression = " AND ".join('"' + t + '"*' for t in terms[:8])
        with self.connect() as conn:
            rows = conn.execute("SELECT p.data FROM product_search s JOIN products p ON p.id=s.id WHERE product_search MATCH ? ORDER BY bm25(product_search) LIMIT ?", (expression, limit * 3)).fetchall()
        products = [json.loads(r[0]) for r in rows]
        # For the reviewed milk alias, don't offer ice cream or milk-free margarine.
        if kind == "milk":
            products = [p for p in products if group_matches("milk", p)]
        return products[:limit]


def import_catalog(source: Path, output: Path):
    products_file = source / "valio_aimo_junction26_product_data.json"
    products = json.loads(products_file.read_text())
    reliability, carbon = {}, {}
    for filename, destination, column in [
        ("delivery_reliability", reliability, "deliveryReliability"),
        ("carbon_footprint", carbon, "AVG kg CO2-eq/kg"),
    ]:
        file = source / f"valio_aimo_junction26_{filename}.csv"
        with file.open(encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                try:
                    destination[row["productId"]] = float(row[column])
                except (ValueError, KeyError):
                    continue
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".importing")
    if temporary.exists():
        temporary.unlink()
    with sqlite3.connect(temporary) as conn:
        conn.execute("CREATE TABLE products (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
        conn.execute("CREATE VIRTUAL TABLE product_search USING fts5(id UNINDEXED, names, tokenize='unicode61')")
        for product in products:
            if product.get("deleted"):
                continue
            names = product.get("synkkaData", {}).get("names", [])
            product["name"] = next((n["value"] for n in names if n["language"] == "en"), next((n["value"] for n in names), product["id"]))
            product["reliability"] = reliability.get(product["id"])
            product["carbon"] = carbon.get(product["id"])
            conn.execute("INSERT INTO products VALUES (?,?)", (product["id"], json.dumps(product, ensure_ascii=False)))
            conn.execute("INSERT INTO product_search VALUES (?,?)", (product["id"], " ".join(n["value"] for n in names)))
    temporary.replace(output)
    print(f"Imported {len(products):,} challenge products into {output}. Raw files were not copied.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("../data/catalog.db"))
    args = parser.parse_args()
    import_catalog(args.source, args.output)
