# Aimo Trust Gateway

A hackathon concept for safe, agent-to-agent foodservice purchasing. An external purchasing agent sends a structured request; an Aimo-operated gateway validates customer policy, finds and compares eligible products, and commits an order only within delegated authority or after customer approval.

**Status:** implemented hackathon prototype. Next.js hosts Customer and Aimo workspaces; FastAPI handles catalog matching, Gemini agents, deterministic policy, approvals and a persistent demo order ledger. “Aimo” refers to Valio Aimo. The original concept documents remain below; implementation details and operational limits are described here and in [the implementation guide](docs/09-implementation.md).

## Run locally

Requirements: Node.js 24, Python 3.11+, and [uv](https://docs.astral.sh/uv/). Docker is optional for local development.

```sh
cp .env.example .env
cd backend
uv sync --frozen
uv run python -m app.catalog --source /path/to/challenge-files
cd ../frontend
npm ci
cd ..
sh scripts/dev.sh
```

The import directory must contain the challenge product JSON, product schema JSON, delivery reliability CSV, and carbon footprint CSV. On the original development machine these files are in `/Users/joonas/Downloads`. The importer uses the product JSON and both CSVs, and keeps raw files outside Git. It creates an ignored `data/catalog.db`.

Open [the local demo](http://127.0.0.1:3000). Both workspaces share the visitor's own sandbox. Other visitors' requests and rule changes remain isolated.

Set `AIMO_API_KEY` and `GEMINI_API_KEY` in `.env` to connect the live services. Keys stay on the Python server. `GEMINI_MODEL` defaults to `gemini-3.8-flash`.

For a demo before keys are available, explicitly set `AIMO_MODE=fixture` in `.env`. It uses the imported challenge products with **invented prices and stock**, labeled throughout the interface. Purchasing requests require Gemini. Customers enter requests in plain language; ambiguous products prompt catalog-backed choices. Live mode never silently falls back to simulated responses.

## Try a purchase

Enter Customer workspace and write a request such as “Order 900 L of milk and 10 kg of oats.” The agent parses the basket and asks you to choose a product type when catalog matches are ambiguous. Every choice binds to actual catalog product IDs. Prices, stock, delivery and customer rules are then checked. Eligible baskets within automatic limits are ordered; baskets above the customer's limits require approval. Unavailable quantities and missing supplier evidence are reported without placing a partial order.

Quantities have no application-imposed maximum. Customer rules govern automatic authorization, while supplier stock and evidence govern fulfillment. Requests must use positive finite quantities and supported units. To revise a request, update its written text; there is no manual basket-line editor or preset scenario selector.

The Rules page changes automatic limits, required attributes and the delivery location. Related orders for the same delivery count toward limits, including concurrently submitted requests. Changing rules invalidates pending previews. The initial milk/oat aliases correspond to reviewed challenge category codes; arbitrary category codes are supported through the API.

## Host on one Docker server

Import the catalog first and copy `.env.example` to `.env`, then:

```sh
docker compose up --build -d
```

Open [the Docker demo](http://localhost:8080). Three containers run Next.js, FastAPI and Caddy. SQLite and TLS state live in named volumes. Only Caddy publishes ports. `docker compose down` preserves orders; **do not use `down -v` if you want to retain them**.

For a domain, set `SITE_ADDRESS=demo.example.com`, `HTTP_PORT=80`, `HTTPS_PORT=443`, `COOKIE_SECURE=true`, and point DNS to the server. Open ports 80 and 443. Caddy obtains and renews HTTPS certificates. Apply updates with `docker compose up --build -d` and check `docker compose logs --tail=100 api web`.

Before an event, run `python3 scripts/preflight.py --url https://demo.example.com`. It checks catalog import, upstream access and sample catalog availability. **Live readiness also requires Gemini configuration.** A successful rehearsal with the supplied keys is still required; the preflight checks configured credentials and eligible live data, not the quality of a model response.

## Verify

```sh
cd backend
uv run pytest -q
cd ../frontend
npm run typecheck
npm run build
```

The Playwright suite covers desktop/mobile ordering, approval, rejection, rule editing and operator access. Start the application with `AIMO_MODE=fixture`, then run `npm run test:e2e` in `frontend` in an environment with Playwright browsers installed. It uses the actual running API; it does not mock successful UI responses.

API reference: [local OpenAPI documentation](http://127.0.0.1:8000/api/docs). Generate frontend contracts from the running API with `npm run generate:api`, or run `backend/.venv/bin/python scripts/export-openapi.py` from the root and `npm run generate:api:file` from `frontend`. Commit the generated `api-schema.ts` when contracts change.

## Record a rehearsal fallback

With the live challenge key configured, run `backend/.venv/bin/python scripts/record-challenge.py` from the repository root. This records only the eight recorded catalog candidates for the next Monday. Set `AIMO_MODE=replay` and restart to use it explicitly. The UI labels recorded responses, checks their date/expiry, and refuses requests absent from the recording. Recordings are ignored by Git.

## Prototype boundaries

- All orders are local demo ledger entries; there are no payments or real purchases.
- Demo identities are intentional role simulations, with no real user authentication or production security claim.
- All basket lines must be eligible; unknown claims, unsupported conversions, unknown terminal stock and unpriced deposit charges block ordering. Approval cannot bypass them.
- Product totals include known tax. Delivery fees are unavailable from the challenge API and are disclosed as unknown. No stock reservation or fixed-price guarantee is implied.
- SQLite plus a single API worker suits a small demo. Keep the backend at one replica; migrate storage and job coordination before scaling.
- Raw challenge data and recordings must remain within the event's sharing terms.

## Start here

- [Vision, scope and pitch](docs/01-vision-and-scope.md)
- [Architecture and agent roles](docs/02-architecture.md)
- [Request, matching and ordering protocol](docs/03-protocol.md)
- [Customer guardrails and approval](docs/04-guardrails-and-approval.md)
- [Trust, security and audit](docs/05-trust-security-audit.md)
- [Synthetic data exploration](docs/06-synthetic-data.md) · [visual overview](synthetic-data-overview.svg)
- [Hackathon demo and delivery plan](docs/07-demo-and-plan.md)
- [Open decisions and mentor questions](docs/08-open-questions.md)

## One-sentence pitch

**The agent can recommend; the policy engine authorizes; the order service commits.**

## Challenge resources

The [challenge portal](https://junction26.valioaimo.fi/) provides synthetic product data, historical delivery reliability, product-group carbon estimates and documentation for mock price and availability APIs. It requires the event password. Obtain credentials from the challenge organizers; do not commit credentials or downloaded datasets without checking their sharing terms. Synthetic data is challenge-only and is not suitable for real purchasing or safety decisions.
