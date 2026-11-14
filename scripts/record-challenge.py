"""Record only the demo shortlist. The recording never changes live-mode behavior."""
import argparse
import asyncio
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from app.catalog import Catalog, DEMO_IDS
from app.config import Settings
from app.providers import ChallengeProvider
from app.schemas import next_monday, now

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=root / "data/replay.json")
args = parser.parse_args()


async def main():
    settings = Settings(_env_file=root / ".env", catalog_path=root / "data/catalog.db", aimo_mode="live")
    catalog = Catalog(settings.catalog_path)
    products = [p for ids in DEMO_IDS.values() for pid in ids if (p := catalog.get(pid))]
    if not products:
        raise SystemExit("Import the challenge catalog first.")
    prices, stock, _ = await ChallengeProvider(settings).quote(products, next_monday())
    recording = {"recorded_at": now().isoformat(), "requestedDate": next_monday().isoformat(), "price": {"products": list(prices.values())}, "availability": {"products": list(stock.values())}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(recording, indent=2))
    print(f"Recorded {len(products)} challenge products for {next_monday()} to {args.output}. Keep this file out of Git.")


asyncio.run(main())
