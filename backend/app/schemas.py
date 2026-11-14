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
    quantity: Decimal = Field(gt=0, le=1000000, max_digits=12, decimal_places=4)
    unit: Unit
    requirements: list[Attribute] = Field(default_factory=list, max_length=3)


class PurchaseRequest(StrictModel):
    text: str = Field(default="", max_length=3000)
    preset: Literal["routine", "approval"] | None = None
    items: list[BasketLine] = Field(default_factory=list, max_length=10)
    needed_by: date = Field(default_factory=next_monday)
    location: str = Field(default="hotel-helsinki", min_length=1, max_length=100)

    @model_validator(mode="after")
    def has_input(self):
        if not self.preset and not self.items and not self.text.strip():
            raise ValueError("Describe the products you need or select an example.")
        return self


class ParsedBasket(StrictModel):
    items: list[BasketLine] = Field(default_factory=list, max_length=10)
    clarification: str | None = None


class QuantityRule(StrictModel):
    group: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9 _-]*$")
    limit: Decimal = Field(gt=0, le=1000000)
    unit: Unit

    @field_validator("group")
    @classmethod
    def normalize_group(cls, value):
        return value.strip().lower()


class AttributeRule(StrictModel):
    group: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9 _-]*$")
    attribute: Attribute

    @field_validator("group")
    @classmethod
    def normalize_group(cls, value):
        return value.strip().lower()


class Policy(StrictModel):
    version: int = Field(default=1, ge=1)
    spend_limit: Decimal = Field(default=Decimal("10000"), gt=0, le=1000000, decimal_places=2)
    location: str = Field(default="hotel-helsinki", min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9 _-]*$")
    quantity_rules: list[QuantityRule] = Field(default_factory=lambda: [QuantityRule(group="milk", limit=1000, unit="L")], max_length=10)
    attribute_rules: list[AttributeRule] = Field(default_factory=lambda: [AttributeRule(group="milk", attribute="lactose_free")], max_length=10)

    @field_validator("quantity_rules")
    @classmethod
    def unique_rules(cls, rules):
        keys = [(r.group.lower(), r.unit) for r in rules]
        if len(set(keys)) != len(keys):
            raise ValueError("Use one quantity limit per product group and unit.")
        return rules


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


class RequestView(BaseModel):
    id: str
    status: Status
    created_at: str
    updated_at: str
    input: PurchaseRequest
    items: list[BasketLine]
    alternatives: list[list[Offer]]
    clarification_choices: list[list[str]] = Field(default_factory=list)
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
