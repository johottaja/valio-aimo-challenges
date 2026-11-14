# Trust, security and audit

## Trust model

The customer delegates limited authority to an external agent. The gateway authenticates that agent and enforces the customer's policy before committing. Agents can recommend; policy code authorizes; the order service commits. A network or conversational separation between the external agent and the final approval component is useful but insufficient on its own.

Treat natural language, catalog descriptions, supplier information and tool output as untrusted content. Never execute instructions embedded in them or allow them to modify policies, identity, tool permissions or approval decisions. Apply strict schemas, least-privilege tool access, scoped identities and server-side checks. Keep secrets outside the repository and use environment variables or a secret store. This is a synthetic hackathon prototype, not a claim of production security.

## Boundaries and controls

- Authenticate clients; authorize by customer, role, location and permitted operation. Resolve identity and rules server-side.
- Maintain a separate customer approver identity; the external purchasing agent cannot approve itself. Authenticate and authorize approval actions.
- Validate and normalize typed inputs, apply deterministic policies, record policy versions and fail safely when evidence is absent.
- Bind approval to the exact immutable order preview and expiry. Recheck material facts and permissions before commitment.
- Scope tools and credentials to the minimum capability. Only the order service can write to the mock order ledger.
- Use idempotency keys, persistent state and deduplicated notifications to prevent duplicate orders from retries. Protect webhooks with authenticated delivery, retries and replay handling.
- Minimize sensitive audit data; restrict Aimo staff access and use retention rules. Do not include passwords, API keys or unnecessary personal data in logs.
- Show source, timestamp and limitations for price, stock and other evidence. Do not describe historical delivery reliability as a current guarantee or category-average carbon as a measured product footprint.

## Customer decision receipt

Present the exact proposed order, why approval is needed, selected option and rationale, meaningful alternatives and exclusion reasons, unknowns, data freshness and expiry, who requested it, and the final decision or order status. Include evidence sufficient to understand the decision without requiring the customer to read an operational trace. Limit customer access to their own account and relevant order.

## Aimo operational trace

Authorized Aimo staff can inspect a structured, chronological execution record: request and correlation IDs, authenticated principal, tool names and relevant inputs and outputs, timestamps, source and freshness of evidence, candidate filtering and ranking rationale, policy results and version, state changes, errors, approval actor and time, and order receipt. Redact or omit secrets and restrict unnecessary customer information.

Record an explicit, reviewable decision rationale tied to evidence and policy checks. Do not depend on exposing raw model reasoning or hidden thinking blocks: they may be unavailable or inconsistent and are not a reliable audit mechanism. A generated explanation is not proof; the underlying tool results and deterministic checks are the evidence.

## Standards and assurance

OpenAPI and JSON Schema are practical, inspectable interface foundations. MCP can wrap the API; it does not itself establish identity, authorization or trust. Signed event records, verifiable credentials and tamper-evident logs are possible future additions. Their value depends on issuer trust, key management, verification and claim freshness; do not suggest a signature makes an incorrect stock claim true.
