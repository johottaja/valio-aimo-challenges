from collections import defaultdict
from decimal import Decimal

from .catalog import GROUPS
from .schemas import BasketPreview, Policy, PolicyDecision


def evaluate(policy: Policy, preview: BasketPreview, related: list[BasketPreview]) -> PolicyDecision:
    if preview.location != policy.location:
        return PolicyDecision(outcome="rejected", reasons=[f"Delivery location {preview.location} is not permitted by the customer rules."], version=policy.version)
    if any(not item.eligible for item in preview.items):
        return PolicyDecision(outcome="needs_information", reasons=["Every basket line needs verified requirement, price, quantity and delivery evidence."], version=policy.version)
    reasons = []
    related = [r for r in related if r.location == preview.location and r.needed_by == preview.needed_by]
    total = preview.total + sum((r.total for r in related), Decimal(0))
    if total > policy.spend_limit:
        reasons.append(f"€{total:,.2f} for this delivery exceeds your €{policy.spend_limit:,.2f} automatic spend limit.")
    for rule in policy.quantity_rules:
        categories = rule.category_codes or GROUPS.get(rule.group.lower(), [rule.group])
        current_amount = sum((item.canonical_quantity for item in preview.items if item.category in categories and item.unit == rule.unit), Decimal(0))
        prior_amount = sum((item.canonical_quantity for p in related for item in p.items if item.category in categories and item.unit == rule.unit), Decimal(0)) if rule.scope == "delivery" else Decimal(0)
        amount = current_amount + prior_amount
        # Unit mismatch is not an implicit pass for a rule that applies to the group.
        if any(item.category in categories and item.unit != rule.unit for item in preview.items):
            return PolicyDecision(outcome="needs_information", reasons=[f"Request {rule.group} in {rule.unit} so its quantity limit can be checked."], version=policy.version)
        if amount > rule.limit:
            if prior_amount:
                reasons.append(f"This basket contains {current_amount:,.0f} {rule.unit} of {rule.group}. Earlier orders and active authorizations for this delivery add {prior_amount:,.0f} {rule.unit} ({amount:,.0f} {rule.unit} total), exceeding your {rule.limit:,.0f} {rule.unit} automatic limit for this delivery.")
            else:
                reasons.append(f"{amount:,.0f} {rule.unit} of {rule.group} exceeds your {rule.limit:,.0f} {rule.unit} automatic limit for this {rule.scope}.")
    return PolicyDecision(outcome="approval_required" if reasons else "eligible", reasons=reasons or ["This basket is within your automatic purchasing limits."], version=policy.version)
