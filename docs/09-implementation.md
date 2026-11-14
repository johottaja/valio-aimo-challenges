# Implementation guide

## Services and contracts

The `frontend/` Next.js app renders the Customer and Aimo workspaces. It uses TanStack Query for API state, Tailwind tokens, Lucide icons and local shadcn-style components with Radix for confirmation dialogs. The frontend consumes generated types from the FastAPI OpenAPI contract. Font files are bundled locally.

The `backend/` FastAPI service owns all identity checks, request state, matching, policy, approval and ledger writes. Customer and Aimo are explicit demo identities; a server-side sandbox session determines role. The purchasing agent is an internal component with no approval or direct ledger capability. Agent input, catalog content and upstream results cannot alter server policy.

Caddy sends `/api/*` to Python and all other paths to Next.js. The Next.js rewrite supports local development without Caddy. Cookies are HttpOnly, SameSite=Lax and configurable Secure for HTTPS; cross-site browser mutations are rejected. Public API responses are not cached. Session tokens are stored as SHA-256 hashes. Every object access verifies sandbox ownership.

## Purchasing state and guarantees

Requests progress through received, interpreting, matching, policy checking, and either automatic commitment, customer approval or an explicit blocked/failed state. One request holds up to ten product needs. Each need has typed quantity, canonical unit and optional supported dietary requirements.

The purchasing agent parses custom text with Gemini structured output. The matching agent validates semantic candidate relevance for Gemini requests, then deterministic code enforces evidence and ranks valid offers by total, historical reliability at equal prices, and product ID. Calls use bounded catalog candidate sets without an application AI deadline; no unbounded agent loop is used.

The catalog index joins products to reliability and carbon by product ID. It searches multilingual names. Only explicit dietary claims count. Conversion uses the catalog sales/base-unit hierarchy with base-package volume or net weight; it never infers volume from weight, gross weight or a product title. Whole physical packages and upstream lot sizes are respected. Excess caused by rounding requires the user to revise the quantity. Variable-weight products and unpriced deposit products are blocked.

Price and availability calls include customer, date and narrowed product IDs. The adapter preserves original price and stock evidence. Unknown prices, incompatible units, invalid date periods, cutoff failures, terminal/sentinel stock and later deliveries are not eligible. Repeated lines are checked against combined stock usage. No upstream stock reservation is available or claimed.

Policies are typed and versioned. Milk and oats are reviewed aliases for categories `10400` and `21370`; category codes are the API fallback. Automatic spend and quantity limits aggregate committed orders and active authorization reservations for the same sandbox, location and delivery date. `BEGIN IMMEDIATE` serializes authorization and ledger changes. Approved exceptions authorize their exact basket only.

Only automatic baskets reserve purchasing authority while awaiting commit-time revalidation. A pending human exception is not a stock or authority reservation. A ten-minute preview is shortened by applicable upstream expiry/cutoff. Approval binds an immutable material fingerprint: products, quantities, price, currency, location, date, policy version and charge disclosure. Fresh check timestamps alone do not invalidate it. Price, quantity, policy or product changes require a fresh review.

An approval route revalidates all current facts and writes every basket line in one database transaction. Duplicate requests are deduplicated by sandbox plus submission idempotency key. Conflicting key payloads are rejected. Approval repeats are deduplicated by exact preview fingerprint and terminal transaction state. Per-request locks and a unique request-to-order constraint prevent duplicate receipts. An approve after reject or reject after commit is a conflict.

Changing policy expires outstanding previews. Startup recovers orders from persisted receipts and marks incomplete jobs interrupted for explicit retry. No successful order is inferred from an HTTP timeout. Demo reset cancels owned work before clearing only that sandbox's records and restoring its rules.

## Endpoints

The authoritative contract is `/api/openapi.json`; interactive documentation is `/api/docs`.

- `GET /api/v1/session`: create or retrieve isolated visitor context.
- `POST /api/v1/session/role`: select the demo Customer or Aimo identity.
- `POST /api/v1/session/reset`: clear the caller's demo sandbox.
- `GET/PUT /api/v1/policy`: retrieve or update versioned rules; only Customer can write.
- `POST /api/v1/requests`: submit request input with `Idempotency-Key`.
- `GET /api/v1/requests` and `GET /api/v1/requests/{id}`: retrieve own requests.
- `GET /api/v1/requests/{id}/events`: structured audit records, never hidden model reasoning.
- `POST /api/v1/requests/{id}/retry` and `/clarify`: restart failed/expired/unresolved work.
- `POST /api/v1/requests/{id}/select`: choose returned eligible alternatives with optimistic revision check.
- `GET /api/v1/approvals/{id}` and `POST .../decision`: Customer-only review and approve/reject, bound to fingerprint.
- `GET /api/v1/orders` and `GET /api/v1/orders/{id}`: own ledger receipts.
- `GET /api/health`: process/database health.
- `GET /api/v1/readiness`: authenticated catalog/configuration and live sample catalog check.

Errors contain a stable code, user-readable message, optional field path and retryability. The live provider never returns fixture responses. The event API key and Gemini key are server-only settings and are excluded from audit evidence.

## Operations

Use `uv sync --frozen` and `npm ci` for reproducible installs. Alembic runs before the container starts; fresh local databases bootstrap automatically. `data/catalog.db` is imported outside container builds and mounted read-only. Mutable SQLite state is mounted separately in a named volume.

Do not copy SQLite's main file while it is writing; use SQLite's backup API or a consistent volume snapshot including WAL state. Preserve the named volume when replacing containers. Check `/api/health`, container restart state and structured request errors. This version has no external telemetry, email, webhook, scheduled job or real fulfillment integration.

Local UI verification can use fixture mode with actual challenge catalog data. Before claiming a live demo, configure both keys, run preflight and rehearse an actual model-driven request including ambiguous product choices and large quantities. Network outages must produce an explicit error or an intentionally selected, labeled recording mode.
