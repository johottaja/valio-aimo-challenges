# Proposed request-to-order protocol

The following payloads are illustrative, not an existing API specification. Define and test exact contracts with OpenAPI and JSON Schema during implementation. All quantities, prices and timestamps below are invented.

## 1. Create a request

```json
{
  "request_id": "req-001",
  "delivery": {"location_id": "hotel-helsinki", "needed_by": "2026-11-16"},
  "items": [{
    "description": "lactose-free milk",
    "quantity": {"value": 1000, "unit": "L"},
    "requirements": [{"attribute": "lactose_free", "operator": "equals", "value": true}]
  }],
  "preferences": {"rank_by": ["eligible_total_price", "delivery_reliability"]}
}
```

The authenticated principal, customer identity, policy version and trusted limits must be resolved server-side. Client-supplied values cannot increase authority. Validate required fields, location, dates, units and quantities; resolve ambiguous language before checking policy. Where evidence or a conversion is unavailable, return an explicit unknown and require clarification or review.

## 2. Validate and evaluate policy

Responses should distinguish:

- `needs_information`: missing or ambiguous fields, with machine-readable issues and human-readable guidance.
- `rejected`: an unpermitted request or a hard rule that cannot be overridden in this workflow.
- `approval_required`: a permitted exception requiring an authorized customer approver.
- `eligible`: eligible for the next stage, not a guarantee that an eventual order will be authorized.

Fixable problems can return to the external agent. Do not repeatedly retry a hard policy failure, silently change constraints, or split an order to evade a limit. Scope the limit explicitly, for example per delivery, customer, location and time window, and evaluate related requests accordingly.

## 3. Find and compare options

Search the catalog, identify candidates and fetch applicable prices and availability. Filter on hard requirements using explicit evidence. Normalize litres, pack sizes, orderable units and quantity increments only when reliable conversion data exists. Rank eligible options according to stated preferences. Include excluded and unknown candidates with their reasons rather than presenting them as eligible.

Return product ID, orderable quantity and units, price and currency, relevant fees where known, availability for the requested date, evidence source and time, and clear rationale. Historical delivery reliability and category-average carbon are optional attributes and must not be portrayed as guarantees or product-specific measurements.

## 4. Select an offer

The external customer agent selects a returned offer ID. The gateway creates an order preview that binds the customer, location, product IDs, quantities, total and currency, delivery details, fees, evidence and policy version. An expiry is a proposed gateway property; do not imply the upstream APIs guarantee price or stock reservation unless their documentation says so.

## 5. Authorize and commit

Re-evaluate policy against the actual order. If approval is required, create a pending approval linked to the exact preview and return its ID and customer-facing link. The chosen demo behavior is **approve and place order**, stated clearly on the button. Before committing, recheck identity, authority, offer validity, price and availability; if material terms change, invalidate approval and require a new preview and approval where applicable. Do not claim a stock or price guarantee if the backend does not provide one.

Use idempotency keys bound to the customer and operation. Treat retries with the same key and same payload as the same operation; reject conflicting reuse. Persist states and receipts so a timeout cannot silently produce duplicates. Any real atomicity or reservation guarantees depend on backend capabilities and are not assumed.

## 6. Notify and retrieve

Return a receipt and expose status through an authenticated polling endpoint. Optionally notify a registered webhook with an event ID; authenticate webhook deliveries, implement retries and make consumers idempotent. Avoid sensitive payloads where a reference suffices. MCP can wrap these endpoints for compatible clients.

## Illustrative states

`received → needs_information | rejected | matching → options_ready → selected → approval_pending | ready_to_commit → committed | failed | expired`.

A rejection or failed approval can end the request; a changed offer requires a new preview. Explicitly model retries, expiry, approvals and revalidation rather than using a conversational loop as the source of truth.
