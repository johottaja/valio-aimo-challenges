# Open decisions and mentor questions

## Product and policy

- Are guardrails configured in Aimo's interface only for the MVP, or can a customer system supply signed policy? The current proposal is customer-managed rules in the Aimo interface.
- Which rules require approval versus outright rejection? What happens when an approver is unavailable?
- What is the exact scope of quantity and spend limits: order, delivery, location, time window, or aggregated related requests? How are concurrent requests accounted for?
- Which customer roles can approve which amounts and locations? Can more than one approver be required?
- Which changes invalidate approval? Proposed default: any material change to item, quantity, price, fees, delivery or relevant policy.
- Does approval place an order immediately? Proposed demo default: yes, with explicit wording and commit-time checks.

## Data and integration

- Inspect the actual OpenAPI specification: supported endpoints, authentication, price and availability semantics, delivery dates, errors, rate limits and any existing order endpoint.
- Are customer-specific prices modeled? Are prices tax-inclusive, are deposits and delivery fees available, and what totals can be guaranteed?
- Does availability reserve stock? Are there price validity or quote-lock semantics? If not, treat timestamps and expiry as gateway-level conventions only.
- Which catalog fields reliably support lactose-free and other requirements, pack conversion, lot sizes, labels and substitutions? What should happen for missing or conflicting evidence?
- How should historical reliability and category-average carbon influence ranking? They should never be represented as guarantees or individual measurements.
- What rights and restrictions govern sharing the source datasets and derived artifacts with hackathon collaborators?

## Security and operations

- Which identity mechanism will the prototype use for agents and for human approvers? What simplifications must be disclosed in the demo?
- How are webhook destinations registered and delivery authenticated? What retry and replay behavior is required?
- How long are order evidence and traces retained, who can access them, and which fields require redaction?
- Which open standard gives the best practical interoperability here? Start with OpenAPI and JSON Schema; consider MCP as a client adapter and signed credentials only if time permits.
- What commitments can the mock backend actually make atomically? Document limitations rather than claiming transactional guarantees it does not provide.
