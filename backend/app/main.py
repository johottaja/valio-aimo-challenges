import hashlib
import secrets
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select

from .config import Settings, get_settings
from .db import Database, Order, Purchase, Reservation, Sandbox, new_sandbox
from .schemas import ApprovalDecision, ApiIssue, ChoiceSelection, OfferSelection, OrderReceipt, Policy, PurchaseRequest, RequestView, RoleSelection, SessionView, next_monday, now
from .workflow import Workflow, WorkflowError, add_event


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    database = Database(settings.database_url)
    workflow = Workflow(settings, database)

    @asynccontextmanager
    async def lifespan(app):
        # Alembic handles deployed schema upgrades; this also makes fresh dev/test
        # databases usable without a separate bootstrap command.
        database.create_schema()
        workflow.recover()
        yield
        await workflow.shutdown()
        database.engine.dispose()

    app = FastAPI(title="Aimo Trust Gateway", version="0.1.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.state.workflow, app.state.database = workflow, database

    @app.middleware("http")
    async def browser_protection(request: Request, call_next):
        if request.method not in {"GET", "HEAD", "OPTIONS"} and request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse(status_code=403, content=ApiIssue(code="cross_site_request", message="Open the demo directly to perform this action.").model_dump())
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(WorkflowError)
    async def workflow_error(request, exc):
        return JSONResponse(status_code=exc.status, content=ApiIssue(code=exc.code, message=exc.message, retryable=exc.retryable).model_dump())

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        first = exc.errors()[0]
        path = ".".join(str(v) for v in first["loc"] if v != "body")
        return JSONResponse(status_code=422, content=ApiIssue(code="invalid_input", message=str(first["msg"]).removeprefix("Value error, "), field=path or None).model_dump())

    def session(request: Request) -> Sandbox:
        token = request.cookies.get("aimo_demo", "")
        hashed = hashlib.sha256(token.encode()).hexdigest()
        with database.read() as db:
            sandbox = db.scalar(select(Sandbox).where(Sandbox.token_hash == hashed))
            if not sandbox or datetime.fromisoformat(sandbox.expires_at) <= now():
                raise WorkflowError("session_expired", "Start a demo session to continue.", 401)
            return sandbox

    def customer(sandbox: Annotated[Sandbox, Depends(session)]) -> Sandbox:
        if sandbox.role != "customer":
            raise WorkflowError("forbidden", "Switch to the Customer workspace to perform this action.", 403)
        return sandbox

    def session_view(sandbox: Sandbox):
        policy = Policy.model_validate_json(sandbox.policy)
        return SessionView(role=sandbox.role, customer_name="Hotel Helsinki", location=policy.location, policy_version=policy.version, next_monday=next_monday(), gemini_ready=bool(settings.gemini_api_key), data_mode=settings.aimo_mode, catalog_count=workflow.catalog.count(), challenge_ready=bool(settings.aimo_api_key) if settings.aimo_mode == "live" else settings.replay_path.exists() if settings.aimo_mode == "replay" else True)

    @app.get("/api/v1/session", response_model=SessionView)
    def get_session(request: Request, response: Response):
        try:
            sandbox = session(request)
        except WorkflowError:
            token = secrets.token_urlsafe(32)
            sandbox = new_sandbox(hashlib.sha256(token.encode()).hexdigest(), settings.demo_session_hours)
            with database.write() as db:
                db.add(sandbox)
            response.set_cookie("aimo_demo", token, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=settings.demo_session_hours * 3600, path="/")
        return session_view(sandbox)

    @app.post("/api/v1/session/role", response_model=SessionView)
    def select_role(selection: RoleSelection, sandbox: Annotated[Sandbox, Depends(session)]):
        with database.write() as db:
            current = db.get(Sandbox, sandbox.id)
            current.role = selection.role
            sandbox.role = selection.role
        return session_view(sandbox)

    @app.post("/api/v1/session/reset", response_model=SessionView)
    async def reset(sandbox: Annotated[Sandbox, Depends(session)]):
        # Cancel and await owned work before removing only this visitor's records.
        with database.read() as db:
            ids = db.scalars(select(Purchase.id).where(Purchase.sandbox_id == sandbox.id)).all()
        import asyncio
        tasks = [workflow.tasks[rid] for rid in ids if rid in workflow.tasks]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        with database.write() as db:
            for table in [Reservation, Order, Purchase]:
                db.execute(delete(table).where(table.sandbox_id == sandbox.id))
            current = db.get(Sandbox, sandbox.id)
            current.policy = Policy().model_dump_json()
            sandbox.policy = current.policy
        for rid in ids:
            workflow.locks.pop(rid, None)
        return session_view(sandbox)

    @app.get("/api/v1/policy", response_model=Policy)
    def get_policy(sandbox: Annotated[Sandbox, Depends(session)]):
        return workflow.policy(sandbox.id)

    @app.put("/api/v1/policy", response_model=Policy)
    def update_policy(policy: Policy, sandbox: Annotated[Sandbox, Depends(customer)]):
        with database.write() as db:
            current = db.get(Sandbox, sandbox.id)
            previous = Policy.model_validate_json(current.policy)
            if policy.version != previous.version:
                raise WorkflowError("policy_conflict", "These rules were edited elsewhere. Reload before saving.")
            policy.version = previous.version + 1
            current.policy = policy.model_dump_json()
            for row in db.scalars(select(Purchase).where(Purchase.sandbox_id == sandbox.id)).all():
                state = RequestView.model_validate_json(row.state)
                if state.status in {"approval_pending", "changed", "ready_to_commit"}:
                    state.status, state.message = "expired", "Customer rules changed. Refresh this basket before placing an order."
                    add_event(state, "Customer", "Rules updated", f"Policy version {policy.version} invalidated this preview.")
                    workflow.save(db, row, state)
            db.execute(delete(Reservation).where(Reservation.sandbox_id == sandbox.id))
        return policy

    @app.post("/api/v1/requests", response_model=RequestView, status_code=202)
    async def submit(payload: PurchaseRequest, sandbox: Annotated[Sandbox, Depends(customer)], idempotency_key: Annotated[str, Header(min_length=8, max_length=128)]):
        state, created = workflow.create(sandbox.id, payload, idempotency_key)
        if created:
            workflow.start(sandbox.id, state.id)
        return state

    @app.get("/api/v1/requests", response_model=list[RequestView])
    def requests(sandbox: Annotated[Sandbox, Depends(session)]):
        return workflow.list_requests(sandbox.id)

    @app.get("/api/v1/requests/{request_id}", response_model=RequestView)
    def request_detail(request_id: str, sandbox: Annotated[Sandbox, Depends(session)]):
        return workflow.get(sandbox.id, request_id)

    @app.get("/api/v1/requests/{request_id}/events")
    def request_events(request_id: str, sandbox: Annotated[Sandbox, Depends(session)]):
        return workflow.get(sandbox.id, request_id).events

    @app.post("/api/v1/requests/{request_id}/retry", response_model=RequestView, status_code=202)
    async def retry(request_id: str, sandbox: Annotated[Sandbox, Depends(customer)]):
        return await workflow.retry(sandbox.id, request_id)

    @app.post("/api/v1/requests/{request_id}/clarify", response_model=RequestView, status_code=202)
    async def clarify(request_id: str, payload: PurchaseRequest, sandbox: Annotated[Sandbox, Depends(customer)]):
        return await workflow.retry(sandbox.id, request_id, payload)

    @app.post("/api/v1/requests/{request_id}/choose-product", response_model=RequestView, status_code=202)
    async def choose_product(request_id: str, selection: ChoiceSelection, sandbox: Annotated[Sandbox, Depends(customer)]):
        return await workflow.choose_product(sandbox.id, request_id, selection)

    @app.post("/api/v1/requests/{request_id}/select", response_model=RequestView)
    async def select_offers(request_id: str, selection: OfferSelection, sandbox: Annotated[Sandbox, Depends(customer)]):
        async with workflow.lock(request_id):
            state = workflow.get(sandbox.id, request_id)
            if state.revision != selection.revision or state.status not in {"approval_pending", "changed"}:
                raise WorkflowError("selection_conflict", "Reload the current basket before changing products.")
            if len(selection.offer_ids) != len(state.items):
                raise WorkflowError("incomplete_selection", "Select one eligible offer for each basket line.", 422)
            chosen = []
            for offered, offer_id in zip(state.alternatives, selection.offer_ids):
                option = next((o for o in offered if o.id == offer_id and o.eligible), None)
                if not option:
                    raise WorkflowError("invalid_offer", "Select a returned eligible offer for each line.", 422)
                chosen.append(option)
            state.preview = workflow.make_preview(state, chosen, workflow.policy(sandbox.id))
            state.status, state.message = "changed", "Product selection changed. Review this basket before placing the order."
            add_event(state, "Customer", "Alternative selected", state.message)
            workflow.update(sandbox.id, state)
            return state

    @app.get("/api/v1/approvals/{request_id}", response_model=RequestView)
    def approval(request_id: str, sandbox: Annotated[Sandbox, Depends(customer)]):
        return workflow.get(sandbox.id, request_id)

    @app.post("/api/v1/approvals/{request_id}/decision", response_model=RequestView)
    async def decision(request_id: str, payload: ApprovalDecision, sandbox: Annotated[Sandbox, Depends(customer)]):
        return await workflow.decide(sandbox.id, request_id, payload.decision, payload.fingerprint)

    @app.get("/api/v1/orders", response_model=list[OrderReceipt])
    def orders(sandbox: Annotated[Sandbox, Depends(session)]):
        with database.read() as db:
            rows = db.scalars(select(Order).where(Order.sandbox_id == sandbox.id)).all()
            return sorted([OrderReceipt.model_validate_json(r.receipt) for r in rows], key=lambda r: r.placed_at, reverse=True)

    @app.get("/api/v1/orders/{order_id}", response_model=OrderReceipt)
    def order(order_id: str, sandbox: Annotated[Sandbox, Depends(session)]):
        with database.read() as db:
            row = db.get(Order, order_id)
            if not row or row.sandbox_id != sandbox.id:
                raise WorkflowError("not_found", "This order is not in your demo workspace.", 404)
            return OrderReceipt.model_validate_json(row.receipt)

    @app.get("/api/health")
    def health():
        with database.read() as db:
            db.execute(select(1))
        return {"status": "ok"}

    @app.get("/api/v1/readiness")
    async def readiness(sandbox: Annotated[Sandbox, Depends(session)]):
        count = workflow.catalog.count()
        checks = {"catalog": count > 0, "gemini": bool(settings.gemini_api_key), "challenge_credentials": bool(settings.aimo_api_key), "mode": settings.aimo_mode, "catalog_count": count}
        if count and (settings.aimo_api_key or settings.aimo_mode != "live"):
            from .schemas import BasketLine
            from .matching import build_offer
            from .providers import UpstreamError
            policy = workflow.policy(sandbox.id)
            results = []
            try:
                for line in [BasketLine(description="lactose-free milk", quantity=1500, unit="L", requirements=["lactose_free"]), BasketLine(description="rolled oats", quantity=10, unit="kg")]:
                    candidates = workflow.catalog.search(line.description, reviewed=True)
                    prices, stock, source = await workflow.provider.quote(candidates, next_monday())
                    eligible = [build_offer(p, line, prices.get(p["id"], {}), stock.get(p["id"], {}), source, next_monday(), policy) for p in candidates]
                    results.append({"need": line.description, "eligible": sum(o.eligible for o in eligible), "issues": [r for o in eligible for r in o.reasons]})
                checks["catalog_samples"] = results
                checks["catalog_samples_ready"] = all(r["eligible"] for r in results)
            except UpstreamError as exc:
                checks["error"] = str(exc)
        return checks

    return app


app = create_app()
