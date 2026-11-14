from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Unit = Literal["L", "kg", "pcs"]
Attribute = Literal["lactose_free", "gluten_free", "vegan"]
Role = Literal["customer", "aimo"]
Status = Literal["received", "interpreting", "matching", "checking_policy", "approval_pending", "ready_to_commit", "committed", "needs_information", "rejected", "failed", "expired", "changed"]


def now() -> datetime:
    return datetime.now(ZoneInfo("UTC"))


def helsinki_today() -> date:
    return datetime.now(ZoneInfo("Europe/Helsinki")).date()


def next_monday() -> date:
    today = helsinki_today()
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BasketLine(StrictModel):
    description: str = Field(min_length=2, max_length=200)
    quantity: Decimal = Field(gt=0, allow_inf_nan=False)
    unit: Unit
    requirements: list[Attribute] = Field(default_factory=list, max_length=3)


class PurchaseRequest(StrictModel):
    text: str = Field(default="", max_length=3000)
    items: list[BasketLine] = Field(default_factory=list, max_length=10)
    needed_by: date = Field(default_factory=next_monday)
    location: str = Field(default="hotel-helsinki", min_length=1, max_length=100)

    @model_validator(mode="after")
    def has_input(self):
        if not self.items and not self.text.strip():
            raise ValueError("Describe the products and quantities you need.")
        return self


class ParsedBasket(StrictModel):
    items: list[BasketLine] = Field(default_factory=list, max_length=10)
    clarification: str | None = None


class QuantityRule(StrictModel):
    group: str = Field(min_length=1, max_length=80)
    category_codes: list[str] = Field(default_factory=list, max_length=1000)
    limit: Decimal = Field(gt=0, allow_inf_nan=False)
    unit: Unit
    scope: Literal["order", "delivery"] = "delivery"

    @field_validator("group")
    @classmethod
    def normalize_group(cls, value):
        return value.strip().lower()


class AttributeRule(StrictModel):
    group: str = Field(min_length=1, max_length=80)
    category_codes: list[str] = Field(default_factory=list, max_length=1000)
    attribute: Attribute

    @field_validator("group")
    @classmethod
    def normalize_group(cls, value):
        return value.strip().lower()


class Policy(StrictModel):
    version: int = Field(default=1, ge=1)
    rules_text: str = Field(default="", max_length=5000)
    location_is_explicit: bool = False
    spend_limit: Decimal = Field(default=Decimal("10000"), gt=0, allow_inf_nan=False)
    location: str = Field(default="hotel-helsinki", min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9 _-]*$")
    quantity_rules: list[QuantityRule] = Field(default_factory=lambda: [QuantityRule(group="milk", limit=1000, unit="L")], max_length=10)
    attribute_rules: list[AttributeRule] = Field(default_factory=lambda: [AttributeRule(group="milk", attribute="lactose_free")], max_length=10)

    @field_validator("quantity_rules")
    @classmethod
    def unique_rules(cls, rules):
        keys = [(r.group.lower(), r.unit, r.scope) for r in rules]
        if len(set(keys)) != len(keys):
            raise ValueError("Use one quantity limit per product group, unit and scope.")
        return rules


class PolicyTextInput(StrictModel):
    text: str = Field(min_length=1, max_length=5000)
    version: int = Field(ge=1)
    spend_limit: Decimal = Field(gt=0, allow_inf_nan=False)


class CatalogCategory(BaseModel):
    code: str
    product_count: int
    examples: list[str]


class Offer(BaseModel):
    id: str
    product_id: str
    name: str
    category: str
    requested: BasketLine
    sales_quantity: Decimal
    sales_unit: str
    canonical_quantity: Decimal
    unit: Unit
    unit_price: Decimal
    total: Decimal
    currency: str
    eligible: bool
    reasons: list[str]
    requirement_evidence: dict[str, str]
    conversion: str
    checked_at: str
    valid_until: str | None = None
    source: str
    reliability: float | None = None
    carbon: float | None = None
    evidence: dict = Field(default_factory=dict)


class PolicyDecision(BaseModel):
    outcome: Literal["eligible", "approval_required", "needs_information", "rejected"]
    reasons: list[str]
    version: int


class BasketPreview(BaseModel):
    id: str
    fingerprint: str
    items: list[Offer]
    total: Decimal
    currency: str
    location: str
    needed_by: date
    policy_version: int
    expires_at: str
    charges_note: str = "Product total includes tax. Delivery fees are not supplied by the challenge API."


class AuditEvent(BaseModel):
    id: str
    at: str
    actor: str
    title: str
    detail: str
    evidence: dict = Field(default_factory=dict)


class OrderReceipt(BaseModel):
    id: str
    request_id: str
    placed_at: str
    authorization: str
    preview: BasketPreview


class ProductChoice(BaseModel):
    label: str = Field(min_length=2, max_length=120)
    product_ids: list[str] = Field(min_length=1, max_length=16)


class ChoiceSelection(StrictModel):
    revision: int
    line_index: int = Field(ge=0)
    choice_index: int = Field(ge=0)


class RequestView(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def migrate_saved_preset_input(cls, value):
        """Read historical snapshots without accepting presets on new requests.

        Recovery writes the normalized snapshot back to storage. Preserve the
        interpreted basket when present, including any customer product choices.
        Older requests that never reached interpretation retain their original
        preset quantities as ordinary basket data.
        """
        if not isinstance(value, dict) or not isinstance(value.get("input"), dict):
            return value
        legacy_input = value["input"]
        if "preset" not in legacy_input:
            return value
        preset = legacy_input["preset"]
        if preset not in (None, "routine", "approval"):
            return value  # Unknown stored data must not be silently discarded.
        migrated_input = {key: item for key, item in legacy_input.items() if key != "preset"}
        if preset and not migrated_input.get("items"):
            migrated_input["items"] = value.get("items") or [
                {"description": "lactose-free milk", "quantity": 500 if preset == "routine" else 1500, "unit": "L", "requirements": ["lactose_free"]},
                {"description": "rolled oats", "quantity": 10, "unit": "kg", "requirements": []},
            ]
        return {**value, "input": migrated_input}

    id: str
    status: Status
    created_at: str
    updated_at: str
    input: PurchaseRequest
    items: list[BasketLine]
    alternatives: list[list[Offer]]
    product_choices: list[ProductChoice] = Field(default_factory=list)
    choice_line_index: int | None = None
    chosen_product_ids: dict[str, list[str]] = Field(default_factory=dict)
    preview: BasketPreview | None
    decision: PolicyDecision | None
    receipt: OrderReceipt | None
    message: str
    agent_mode: str
    data_mode: str
    events: list[AuditEvent]
    revision: int


class SessionView(BaseModel):
    role: Role
    customer_name: str
    location: str
    policy_version: int
    next_monday: date
    gemini_ready: bool
    data_mode: str
    catalog_count: int
    challenge_ready: bool


class RoleSelection(StrictModel):
    role: Role


class ApprovalDecision(StrictModel):
    decision: Literal["approve", "reject"]
    fingerprint: str


class OfferSelection(StrictModel):
    offer_ids: list[str] = Field(min_length=1, max_length=10)
    revision: int = Field(ge=1)


class ApiIssue(BaseModel):
    code: str
    message: str
    field: str | None = None
    retryable: bool = False
