"""Check the actual running deployment without printing credentials."""
import argparse
import json
import sys
import urllib.request
from http.cookiejar import CookieJar

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://localhost:8080")
args = parser.parse_args()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
try:
    client.open(args.url.rstrip("/") + "/api/v1/session")
    checks = json.load(client.open(args.url.rstrip("/") + "/api/v1/readiness"))
    print(json.dumps(checks, indent=2))
    ready = checks.get("catalog") and checks.get("catalog_samples_ready") and checks.get("gemini") and checks.get("mode") == "live"
    print("Live demo ready." if ready else "Live demo not yet ready. Resolve the checks above; simulated/replay mode is not live readiness.")
    sys.exit(0 if ready else 1)
except Exception as exc:
    print(f"Could not check deployment: {type(exc).__name__}", file=sys.stderr)
    sys.exit(1)
