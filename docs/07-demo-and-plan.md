# Hackathon demo and delivery plan

## Demo story

A hotel asks its external purchasing agent for lactose-free milk for Monday. Its account policy allows up to 1,000 L automatically per delivery. Use actual synthetic catalog products and mock API responses where feasible; any invented data or simulated backend behavior must be labeled.

1. Show the agent submitting a structured request for an in-policy amount. Validate customer identity and policy.
2. Search Aimo's assortment and query mock price and availability. Explain eligibility, pack conversions and unknowns. Show multiple options with the customer's selection.
3. Commit the in-policy order through the mock order service after revalidation. Show an unambiguous receipt and trace.
4. Submit 1,500 L. The same policy triggers customer approval; send an event and display a link in the external agent's interface.
5. Open the authenticated customer approval page. Show exact order, amount, policy reason, alternatives, source times and expiry. The button says **Approve and place order**.
6. Revalidate, commit the mock order and show the customer receipt and Aimo's operational trace. If a demo variant changes the offer, show reapproval instead of committing changed terms.

Choose one reliable end-to-end path first. A shortage or substitute is a compelling optional second scenario, but it must not replace core ordering and authorization.

## MVP build sequence

1. Inspect the supplied OpenAPI and dataset schema; establish what pricing, availability, units and ordering capabilities actually exist.
2. Build an indexed local product search and read-only integrations for price and availability. Preserve unknowns and provenance.
3. Define request, offer, policy, approval, order and event schemas. Implement deterministic rule checks with clear outcomes.
4. Implement a mock order ledger, idempotency, explicit states and commit-time revalidation.
5. Add customer approval with an explicit demo identity/role model, decision receipt and status; make any simplified authentication obvious.
6. Add matching and explanation tools, then an agent client or MCP adapter if time permits. The agent must not override policy.
7. Add an Aimo operational trace and a webhook or polling fallback. Rehearse failure paths and resettable synthetic demo fixtures.

## Validation that matters

Test normal in-policy order; over-limit approval; rejected or expired approval; a material price/availability change after selection; missing evidence or pack conversion; malformed request; unauthorized approver; duplicate request/commit retry; and attempts to evade aggregate limits by splitting requests. Verify API behavior rather than inventing guarantees about price locks or stock reservations.

## Pitch

**Problem:** autonomous purchasing needs a trusted route into a wholesaler, with customer authority intact.

**Solution:** an open gateway that turns a structured request into comparable evidence, an enforceable authorization decision and a traceable order.

**Memorable line:** The agent can recommend; the policy engine authorizes; the order service commits.

**Proof:** one order goes through; one stops for customer approval; both leave an understandable receipt and operational trace.
