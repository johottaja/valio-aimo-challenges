"""Run with backend/.venv/bin/python scripts/export-openapi.py from repository root."""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from app.main import app

(root / "frontend/src/lib/openapi.json").write_text(json.dumps(app.openapi()))
print("Exported backend OpenAPI. Generate TypeScript with npm run generate:api:file in frontend/.")
