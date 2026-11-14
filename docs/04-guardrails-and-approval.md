# Customer guardrails and approval

## Policy model

Customers configure policies manually in their own account. Examples: per-order and period spend ceilings; automatic quantity limits in canonical units; allowed delivery locations; approved product categories or brands; hard dietary requirements; substitution permissions; and authorized approvers. Rules should be typed, versioned and evaluated by deterministic code. Natural-language guidelines must be translated into explicit rules and confirmed before they are enforced as hard policy.

Each rule needs a defined scope, unit, time window, aggregation behavior, action on violation, and treatment of missing data. “No more than 1,000 litres automatically” should specify whether the threshold is per order, per delivery or over a period, and whether related requests are aggregated. Splitting an order must not defeat the intended limit. Concurrent orders require atomic accounting if enforcing an aggregate budget.

Suggested outcomes: allow, request information, require approval, or reject. Unknown evidence is a separate state; it is never silently treated as compliant. Some constraints may be non-overridable in this workflow. Customer approval does not grant authority to bypass legal, safety or system-level restrictions.

## Who confirms where?

Customer decisions belong to an authenticated, authorized **customer approver**, not Aimo staff and not the external agent. Aimo's operational panel may show and investigate the process but does not approve customer exceptions on their behalf. Aimo-side exceptions, if modeled, have their own distinct Aimo approval policy and actors.

The baseline customer experience is an Aimo-hosted approval page. The customer's agent receives an `approval_required` result and can surface its link in the customer's existing purchasing workflow. A webhook can signal the event; authenticated polling is a fallback. Future integrations may provide native approval in the customer's own application, provided identity, authority and the exact decision are securely verified.

## Approval page

The customer sees a concise decision receipt:

1. Exact products, quantities and pack conversion; total, currency and any fees; delivery location and date.
2. The policy reason: for example, 1,500 L exceeds the 1,000 L automatic limit per delivery.
3. Why the selected option meets requirements and which trade-offs mattered.
4. Other considered options, their comparable facts, and why they were ranked lower, excluded or marked unknown.
5. Missing or uncertain evidence, with no implied compliance.
6. Price and availability check times, offer expiry and any limitations.
7. Requester, policy version and decision history appropriate to the customer.
8. Clear **Approve and place order** and **Reject** controls, plus the meaning of each action.

A link is not itself authority: authenticate the human and authorize them for the customer and transaction. Approval binds the exact immutable order preview and a limited validity period. Material changes require revalidation and, when needed, renewed approval. Rejection, expiry, concurrent approval, failure and repeated submissions must have explicit behavior. Show final status rather than assuming a click guarantees commitment.

## Illustrative scenario

A customer agent requests 1,500 L of lactose-free milk for Monday. The customer's rule allows up to 1,000 L per delivery automatically. The system finds eligible products and presents options; the agent selects one. The customer approver sees the exact order and reason for escalation, then approves and places it. The order service rechecks current facts before recording the mock order. If terms have changed, the page reports that a new review is needed instead of committing the changed order.
