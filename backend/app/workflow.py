import asyncio
import hashlib
import json
import logging
import secrets
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import delete, select

from .agents import AgentError, MatchingAgent, PurchasingAgent
from .catalog import Catalog
from .config import Settings
from .db import Database, Order, Purchase, Reservation, Sandbox, dump
from .matching import build_offer, rank_offers, check_combined_stock
from .policy import evaluate
from .providers import ChallengeProvider, UpstreamError, parse_time
from .schemas import AuditEvent, BasketPreview, Offer, OrderReceipt, Policy, PurchaseRequest, RequestView, now, helsinki_today

logger = logging.getLogger(__name__)
ACTIVE = {"received", "interpreting", "matching", "checking_policy", "ready_to_commit"}


class WorkflowError(Exception):
    def __init__(self, code: str, message: str, status: int = 409, retryable: bool = False):
        self.code, self.message, self.status, self.retryable = code, message, status, retryable
        super().__init__(message)


def fingerprint(preview: BasketPreview) -> str:
    material = {"items": [{"product": i.product_id, "quantity": str(i.sales_quantity), "canonical_quantity": str(i.canonical_quantity), "unit": i.unit, "price": str(i.unit_price), "total": str(i.total), "currency": i.currency, "requirements": sorted(i.requested.requirements)} for i in preview.items], "total": str(preview.total), "location": preview.location, "date": str(preview.needed_by), "policy": preview.policy_version, "charges": preview.charges_note}
    return hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest()


def add_event(state: RequestView, actor: str, title: str, detail: str, evidence: dict | None = None):
    state.events.append(AuditEvent(id=secrets.token_hex(8), at=now().isoformat(), actor=actor, title=title, detail=detail, evidence=evidence or {}))
    state.updated_at = now().isoformat()


class Workflow:
    def __init__(self, settings: Settings, db: Database):
        self.settings, self.db = settings, db
        self.catalog = Catalog(settings.catalog_path)
        self.provider = ChallengeProvider(settings)
        self.purchaser, self.matcher = PurchasingAgent(settings), MatchingAgent(settings)
        self.semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self.tasks: dict[str, asyncio.Task] = {}
        self.locks: dict[str, asyncio.Lock] = {}

    def lock(self, request_id: str):
        return self.locks.setdefault(request_id, asyncio.Lock())

    def get(self, sandbox_id: str, request_id: str) -> RequestView:
        with self.db.read() as db:
            row = db.get(Purchase, request_id)
            if not row or row.sandbox_id != sandbox_id:
                raise WorkflowError("not_found", "This request is not in your demo workspace.", 404)
            state = RequestView.model_validate_json(row.state)
        if state.preview and state.status in {"approval_pending", "changed"} and parse_time(state.preview.expires_at) <= now():
            with self.db.write() as db:
                row = db.get(Purchase, request_id)
                latest = RequestView.model_validate_json(row.state)
                if latest.status in {"approval_pending", "changed"}:
                    latest.status, latest.message = "expired", "This basket expired. Refresh prices and availability before ordering."
                    add_event(latest, "Policy engine", "Preview expired", latest.message)
                    self.save(db, row, latest)
                    db.execute(delete(Reservation).where(Reservation.request_id == request_id))
                    state = latest
                else:
                    state = latest
        return state

    def list_requests(self, sandbox_id: str) -> list[RequestView]:
        with self.db.read() as db:
            rows = db.scalars(select(Purchase).where(Purchase.sandbox_id == sandbox_id)).all()
            ids = [r.id for r in rows]
        return sorted([self.get(sandbox_id, rid) for rid in ids], key=lambda r: r.created_at, reverse=True)

    @staticmethod
    def save(db, row: Purchase, state: RequestView):
        state.revision = row.revision + 1
        row.revision = state.revision
        row.state = state.model_dump_json()

    def update(self, sandbox_id: str, state: RequestView):
        with self.db.write() as db:
            row = db.get(Purchase, state.id)
            if not row or row.sandbox_id != sandbox_id:
                raise WorkflowError("not_found", "The demo was reset while this request was running.", 404)
            self.save(db, row, state)

    def policy(self, sandbox_id: str) -> Policy:
        with self.db.read() as db:
            sandbox = db.get(Sandbox, sandbox_id)
            if not sandbox:
                raise WorkflowError("session_expired", "Start a new demo session.", 401)
            return Policy.model_validate_json(sandbox.policy)

    def create(self, sandbox_id: str, request: PurchaseRequest, key: str) -> tuple[RequestView, bool]:
        payload_hash = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
        with self.db.write() as db:
            previous = db.scalar(select(Purchase).where(Purchase.sandbox_id == sandbox_id, Purchase.idempotency_key == key))
            if previous:
                if previous.payload_hash != payload_hash:
                    raise WorkflowError("idempotency_conflict", "This submission key was already used for a different basket.")
                return RequestView.model_validate_json(previous.state), False
            count = len(db.scalars(select(Purchase.id).where(Purchase.sandbox_id == sandbox_id)).all())
            if count >= 100:
                raise WorkflowError("demo_limit", "Start a fresh demo to submit more requests.", 429)
            rid = "REQ-" + secrets.token_hex(4).upper()
            timestamp = now().isoformat()
            state = RequestView(id=rid, status="received", created_at=timestamp, updated_at=timestamp, input=request, items=[], alternatives=[], preview=None, decision=None, receipt=None, message="Your purchasing agent is starting.", agent_mode="Purchasing agent", data_mode=self.settings.aimo_mode, events=[], revision=1)
            add_event(state, "Purchasing agent", "Request received", request.text or "Structured basket received.", {"input": request.model_dump(mode="json")})
            db.add(Purchase(id=rid, sandbox_id=sandbox_id, idempotency_key=key, payload_hash=payload_hash, state=state.model_dump_json(), revision=1))
        return state, True

    def start(self, sandbox_id: str, request_id: str):
        if request_id in self.tasks and not self.tasks[request_id].done():
            return
        task = asyncio.create_task(self.run(sandbox_id, request_id))
        self.tasks[request_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(request_id, None))

    def recover(self):
        with self.db.write() as db:
            for row in db.scalars(select(Purchase)).all():
                state = RequestView.model_validate_json(row.state)
                receipt = db.scalar(select(Order).where(Order.request_id == row.id))
                if receipt:
                    state.receipt = OrderReceipt.model_validate_json(receipt.receipt)
                    state.status = "committed"
                elif state.status in ACTIVE:
                    state.status, state.message = "failed", "The server restarted during processing. Retry this request; no order was placed."
                    add_event(state, "Order service", "Processing interrupted", state.message)
                    db.execute(delete(Reservation).where(Reservation.request_id == row.id))
                self.save(db, row, state)

    async def shutdown(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    def make_preview(self, state: RequestView, items: list[Offer], policy: Policy) -> BasketPreview:
        expires = now() + timedelta(minutes=self.settings.preview_minutes)
        for offer in items:
            if (valid := parse_time(offer.valid_until)):
                expires = min(expires, valid)
        preview = BasketPreview(id="BKT-" + secrets.token_hex(5).upper(), fingerprint="", items=items, total=sum((i.total for i in items), Decimal(0)), currency="EUR", location=state.input.location, needed_by=state.input.needed_by, policy_version=policy.version, expires_at=expires.isoformat())
        preview.fingerprint = fingerprint(preview)
        return preview

    def related(self, db, sandbox_id: str, request_id: str) -> list[BasketPreview]:
        committed = [OrderReceipt.model_validate_json(r.receipt).preview for r in db.scalars(select(Order).where(Order.sandbox_id == sandbox_id, Order.request_id != request_id)).all()]
        db.execute(delete(Reservation).where(Reservation.expires_at < now().isoformat()))
        pending = [BasketPreview.model_validate_json(r.preview) for r in db.scalars(select(Reservation).where(Reservation.sandbox_id == sandbox_id, Reservation.request_id != request_id)).all()]
        return committed + pending

    def authorize(self, sandbox_id: str, state: RequestView):
        with self.db.write() as db:
            row, sandbox = db.get(Purchase, state.id), db.get(Sandbox, sandbox_id)
            if not row or not sandbox:
                raise WorkflowError("not_found", "Your demo session was reset.", 404)
            policy = Policy.model_validate_json(sandbox.policy)
            if state.preview.policy_version != policy.version:
                raise WorkflowError("policy_changed", "The rules changed while matching. Refresh this request.")
            state.decision = evaluate(policy, state.preview, self.related(db, sandbox_id, state.id))
            state.message = " ".join(state.decision.reasons)
            state.status = {"eligible": "ready_to_commit", "approval_required": "approval_pending", "needs_information": "needs_information", "rejected": "rejected"}[state.decision.outcome]
            add_event(state, "Policy engine", "Customer rules checked", state.message, state.decision.model_dump())
            if state.status == "ready_to_commit":
                db.merge(Reservation(request_id=state.id, sandbox_id=sandbox_id, preview=state.preview.model_dump_json(), expires_at=state.preview.expires_at))
            self.save(db, row, state)

    async def run(self, sandbox_id: str, request_id: str):
        async with self.semaphore, self.lock(request_id):
            try:
                state = self.get(sandbox_id, request_id)
                state.status, state.message = "interpreting", "Understanding the products and quantities you need."
                self.update(sandbox_id, state)
                if state.input.needed_by < helsinki_today():
                    raise AgentError("Choose a delivery date that has not passed.")
                if not self.catalog.count():
                    raise AgentError("Import the challenge catalog before purchasing. See the setup instructions.")
                parsed = await self.purchaser.interpret(state.input)
                state.items = parsed.items
                if parsed.clarification or not parsed.items:
                    raise AgentError(parsed.clarification or "Please specify products, quantities, and units.")
                state.status, state.message = "matching", "Finding suitable products and checking prices and delivery."
                add_event(state, "Purchasing agent", "Basket understood", f"{len(state.items)} product needs, delivery to {state.input.location} on {state.input.needed_by}.", {"items": [i.model_dump(mode="json") for i in state.items]})
                self.update(sandbox_id, state)
                policy = self.policy(sandbox_id)
                state.alternatives = []
                selected = []
                for index, line in enumerate(state.items):
                    chosen_ids = state.chosen_product_ids.get(str(index))
                    if chosen_ids is not None:
                        candidates = [p for product_id in chosen_ids if (p := self.catalog.get(product_id))]
                        explanation = "Customer chose this catalog product group."
                    else:
                        candidates = self.catalog.search(line.description, requirements=line.requirements, policy=policy)
                        candidates, explanation = await self.matcher.narrow(line, candidates)
                    if candidates:
                        price, stock, source = await self.provider.quote(candidates, state.input.needed_by)
                        offers = rank_offers([build_offer(p, line, price.get(p["id"], {}), stock.get(p["id"], {}), source, state.input.needed_by, policy) for p in candidates])
                    else:
                        offers = []
                    state.alternatives.append(offers)
                    add_event(state, "Aimo matching agent", f"Compared options for {line.description}", explanation, {"line": index, "candidate_count": len(candidates), "eligible_count": sum(o.eligible for o in offers), "options": [o.model_dump(mode="json") for o in offers]})
                    eligible = [o for o in offers if o.eligible]
                    if chosen_ids is None:
                        eligible_ids = {o.product_id for o in eligible}
                        choices = await self.matcher.product_choices(line, [p for p in candidates if p["id"] in eligible_ids])
                        if choices:
                            state.product_choices, state.choice_line_index = choices, index
                            state.status, state.message = "needs_information", f"Choose which type of {line.description} you want. Nothing has been ordered."
                            add_event(state, "Purchasing agent", "Product choice needed", state.message)
                            self.update(sandbox_id, state)
                            return
                    if eligible:
                        selected.append(eligible[0])
                    self.update(sandbox_id, state)
                check_combined_stock(selected)
                if len(selected) != len(state.items) or any(not o.eligible for o in selected):
                    missing = [line.description for line, options in zip(state.items, state.alternatives) if not any(o.eligible for o in options)]
                    state.status, state.message = "needs_information", f"No complete eligible basket: review {', '.join(missing) or 'the combined quantities of repeated products'}. Nothing has been ordered."
                    for line, options in zip(state.items, state.alternatives):
                        if options and not any(o.eligible for o in options):
                            rounded = [o for o in options if o.reasons and all(r.startswith("Pack rounding would deliver") for r in o.reasons)]
                            if rounded:
                                nearest = min(rounded, key=lambda o: o.canonical_quantity)
                                state.message += f" {line.description}: You requested {line.quantity:g} {line.unit}, but the smallest verified whole-pack option would deliver {nearest.canonical_quantity:g} {nearest.unit}. Revise the quantity to order a whole pack."
                                continue
                            quantity_issue = next((r for o in options for r in o.reasons if "are needed" in r or "Combined basket needs" in r), None)
                            state.message += f" {line.description}: {quantity_issue or options[0].reasons[0]}"
                    add_event(state, "Policy engine", "Basket needs attention", state.message)
                    self.update(sandbox_id, state)
                    return
                state.status = "checking_policy"
                state.preview = self.make_preview(state, selected, policy)
                add_event(state, "Purchasing agent", "Selected complete basket", "Lowest eligible total per product need, with delivery history as a price tie-breaker.")
                self.update(sandbox_id, state)
                self.authorize(sandbox_id, state)
                if state.status == "ready_to_commit":
                    await self.commit(sandbox_id, state, approved=False)
            except asyncio.CancelledError:
                raise
            except (AgentError, UpstreamError, WorkflowError, TimeoutError) as exc:
                self.fail(sandbox_id, request_id, str(exc), needs_information=isinstance(exc, AgentError))
            except Exception:
                logger.exception("Purchasing workflow failed for %s", request_id)
                self.fail(sandbox_id, request_id, "The request could not finish. No order was placed. Please retry.")

    def fail(self, sandbox_id: str, request_id: str, message: str, needs_information=False):
        try:
            with self.db.write() as db:
                row = db.get(Purchase, request_id)
                if not row or row.sandbox_id != sandbox_id:
                    return
                state = RequestView.model_validate_json(row.state)
                if state.status == "committed":
                    return
                state.status = "needs_information" if needs_information else "failed"
                state.message = message
                add_event(state, "Order service", "Action needed" if needs_information else "Processing stopped", message)
                db.execute(delete(Reservation).where(Reservation.request_id == request_id))
                self.save(db, row, state)
        except Exception:
            logger.exception("Could not persist failure for %s", request_id)

    async def commit(self, sandbox_id: str, state: RequestView, approved: bool) -> RequestView:
        original = state.preview
        if not original or parse_time(original.expires_at) <= now():
            raise WorkflowError("preview_expired", "This basket expired. Refresh before ordering.")
        policy = self.policy(sandbox_id)
        products = [self.catalog.get(item.product_id) for item in original.items]
        if any(p is None for p in products):
            raise WorkflowError("product_missing", "A selected product is no longer in the catalog.")
        prices, stocks, source = await self.provider.quote(products, original.needed_by)
        fresh_items = [build_offer(p, offer.requested, prices.get(p["id"], {}), stocks.get(p["id"], {}), source, original.needed_by, policy) for p, offer in zip(products, original.items)]
        check_combined_stock(fresh_items)
        fresh = self.make_preview(state, fresh_items, policy)
        with self.db.write() as db:
            row = db.get(Purchase, state.id)
            sandbox = db.get(Sandbox, sandbox_id)
            if not row or not sandbox:
                raise WorkflowError("not_found", "The demo session was reset.", 404)
            current = RequestView.model_validate_json(row.state)
            if current.receipt:
                return current
            if current.status not in {"ready_to_commit", "approval_pending", "changed"} or not current.preview or current.preview.fingerprint != original.fingerprint:
                raise WorkflowError("state_changed", "This basket changed. Reload the current decision.")
            if approved and sandbox.role != "customer":
                raise WorkflowError("forbidden", "Only the demo customer can approve an order.", 403)
            if parse_time(original.expires_at) <= now():
                raise WorkflowError("preview_expired", "This basket expired during revalidation. Refresh before ordering.")
            current_policy = Policy.model_validate_json(sandbox.policy)
            if current_policy.version != policy.version:
                raise WorkflowError("policy_changed", "Rules changed during revalidation. Refresh the basket.")
            decision = evaluate(current_policy, fresh, self.related(db, sandbox_id, state.id))
            db.execute(delete(Reservation).where(Reservation.request_id == state.id))
            current.decision = decision
            if decision.outcome in {"rejected", "needs_information"}:
                current.preview = fresh
                current.status = decision.outcome
                current.message = "The basket is no longer eligible. " + " ".join(r for o in fresh_items for r in o.reasons) + " " + " ".join(decision.reasons)
                add_event(current, "Order service", "Revalidation blocked order", current.message)
                self.save(db, row, current)
                return current
            if fresh.fingerprint != original.fingerprint:
                current.preview, current.status = fresh, "changed"
                current.message = "The basket changed. Review the updated order before placing it."
                add_event(current, "Order service", "New review required", current.message)
                self.save(db, row, current)
                return current
            if not approved and decision.outcome == "approval_required":
                current.status, current.message = "approval_pending", " ".join(decision.reasons)
                self.save(db, row, current)
                return current
            # Preserve original approval deadline while storing fresh evidence.
            fresh.expires_at = min(parse_time(original.expires_at), parse_time(fresh.expires_at)).isoformat()
            receipt = OrderReceipt(id="AIMO-" + secrets.token_hex(4).upper(), request_id=state.id, placed_at=now().isoformat(), authorization="Approved by demo customer" if approved else "Ordered automatically", preview=fresh)
            current.preview, current.receipt, current.status = fresh, receipt, "committed"
            current.message = "Your demo order has been placed."
            add_event(current, "Customer" if approved else "Policy engine", "Customer approved exact basket" if approved else "Automatic authority verified", receipt.authorization, {"fingerprint": original.fingerprint, "policy_version": policy.version})
            add_event(current, "Order service", "Demo order placed", f"Receipt {receipt.id}; all {len(fresh.items)} lines recorded together after revalidation.", {"receipt_id": receipt.id})
            db.add(Order(id=receipt.id, request_id=state.id, sandbox_id=sandbox_id, receipt=receipt.model_dump_json()))
            self.save(db, row, current)
            return current

    async def decide(self, sandbox_id: str, request_id: str, action: str, binding: str) -> RequestView:
        async with self.lock(request_id):
            state = self.get(sandbox_id, request_id)
            if state.receipt:
                if action == "reject":
                    raise WorkflowError("already_ordered", "This basket has already been ordered and cannot be rejected.")
                if state.preview.fingerprint != binding:
                    raise WorkflowError("approval_conflict", "This approval refers to an older basket.")
                return state
            if state.status == "rejected" and action == "reject" and state.preview and state.preview.fingerprint == binding:
                return state
            if state.status not in {"approval_pending", "changed"} or not state.preview:
                raise WorkflowError("not_pending", "This request is not awaiting approval. Reload its current status.")
            if state.preview.fingerprint != binding:
                raise WorkflowError("approval_conflict", "This approval refers to an older basket. Review the latest version.")
            if action == "reject":
                state.status, state.message = "rejected", "Rejected — no order placed."
                add_event(state, "Customer", "Customer rejected basket", state.message)
                self.update(sandbox_id, state)
                return state
            try:
                return await self.commit(sandbox_id, state, approved=True)
            except UpstreamError as exc:
                raise WorkflowError("upstream_unavailable", str(exc), 503, True) from exc

    async def retry(self, sandbox_id: str, request_id: str, request: PurchaseRequest | None = None) -> RequestView:
        async with self.lock(request_id):
            state = self.get(sandbox_id, request_id)
            if state.status not in {"failed", "expired", "needs_information"}:
                raise WorkflowError("cannot_retry", "This request cannot be restarted in its current state.")
            if request is not None:
                state.input = request
                state.agent_mode = "Purchasing agent"
            # An explicit refresh reopens the search under current rules and
            # availability, including choices made before those checks changed.
            state.chosen_product_ids = {}
            state.status, state.preview, state.decision, state.alternatives = "received", None, None, []
            state.product_choices, state.choice_line_index = [], None
            add_event(state, "Customer", "Request refreshed", "Rechecking the complete basket against current rules and upstream evidence.")
            self.update(sandbox_id, state)
        self.start(sandbox_id, request_id)
        return state

    async def choose_product(self, sandbox_id: str, request_id: str, selection) -> RequestView:
        async with self.lock(request_id):
            state = self.get(sandbox_id, request_id)
            if state.status != "needs_information" or state.revision != selection.revision or state.choice_line_index != selection.line_index or selection.choice_index >= len(state.product_choices):
                raise WorkflowError("selection_conflict", "These choices are no longer current. Refresh the request.")
            choice = state.product_choices[selection.choice_index]
            state.chosen_product_ids[str(selection.line_index)] = choice.product_ids
            state.input = state.input.model_copy(update={"items": state.items})
            state.product_choices, state.choice_line_index = [], None
            state.alternatives, state.preview, state.decision = [], None, None
            state.status, state.message = "received", "Checking the product type you chose."
            add_event(state, "Customer", "Product type selected", choice.label, {"product_ids": choice.product_ids})
            self.update(sandbox_id, state)
        self.start(sandbox_id, request_id)
        return state
