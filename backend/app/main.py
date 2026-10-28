from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import SessionLocal, init_db
from .marketdata.service import init_instruments
from .models import Backtest, Experiment
from .routers import alerts, auth, datasets, market, ml, paper, portfolios, strategies, system, watchlists

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s level=%(levelname)s logger=%(name)s %(message)s",
)
logger = logging.getLogger("stockpulse")

_stop = threading.Event()


def _scheduler_loop() -> None:
    from .alerts_engine import evaluate_all_active
    from .models import PaperAccount, PaperOrder
    from .paper.engine import process_open_orders

    while not _stop.wait(120):
        db = SessionLocal()
        try:
            fired = evaluate_all_active(db, limit=100)
            if fired:
                logger.info("alert_scheduler fired=%s", fired)
            account_ids = {
                row[0]
                for row in db.query(PaperOrder.account_id)
                .filter(PaperOrder.status == "OPEN")
                .distinct()
                .limit(100)
                .all()
            }
            for account_id in account_ids:
                account = db.get(PaperAccount, account_id)
                if account:
                    process_open_orders(db, account)
        except Exception as exc:  # keep the scheduler alive
            logger.warning("scheduler_cycle_failed error=%s", exc)
            db.rollback()
        finally:
            db.close()


def _recover_jobs() -> None:
    db = SessionLocal()
    try:
        for exp in db.query(Experiment).filter(Experiment.status.in_(["queued", "running"])).all():
            exp.status = "failed"
            exp.error = "Interrupted by server restart. Queued and in-flight jobs are not durable in this build."
        for bt in db.query(Backtest).filter(Backtest.status.in_(["queued", "running"])).all():
            bt.status = "failed"
            bt.error = "Interrupted by server restart. Queued and in-flight jobs are not durable in this build."
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_runtime()
    if settings.auto_create_schema:
        init_db()
    db = SessionLocal()
    try:
        init_instruments(db)
    finally:
        db.close()
    _recover_jobs()
    if settings.background_jobs:
        thread = threading.Thread(target=_scheduler_loop, daemon=True, name="stockpulse-scheduler")
        thread.start()
        logger.info("background_scheduler_started interval=120s")
    yield
    _stop.set()


app = FastAPI(
    title="StockPulse AI API",
    version="0.1.0",
    description=(
        "Research and paper-trading API. Market data is delayed/end-of-day via Yahoo Finance, "
        "or clearly labelled simulated data when configured. No live brokerage execution is implemented."
    ),
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

origins = list(dict.fromkeys(settings.origins + [settings.app_url]))
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Requested-With"],
    max_age=600,
)


@app.middleware("http")
async def security_and_csrf(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        same_origin = f"{request.url.scheme}://{request.url.netloc}"
        if origin and origin not in origins and origin != same_origin:
            return JSONResponse(status_code=403, content={"detail": "Cross-origin request rejected"})
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > 25 * 1024 * 1024:
            return JSONResponse(status_code=413, content={"detail": "Request too large"})
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if request.url.path in {"/api/docs", "/redoc", "/docs/oauth2-redirect"}:
        # FastAPI's generated docs load assets from jsDelivr and a small inline
        # bootstrap. Keep this exception scoped to documentation pages.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "img-src 'self' data: https://fastapi.tiangolo.com; font-src 'self' data:; "
            "connect-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'"
        )
    else:
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; font-src 'self' data:; connect-src 'self' "
            + " ".join(origins)
            + "; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
    if settings.cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if (
        request.url.path.startswith("/api/")
        or request.url.path in {"/health", "/ready"}
        or response.headers.get("content-type", "").startswith("text/html")
    ):
        response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
    return response


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    logger.error("unhandled_error path=%s error=%s", request.url.path, exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error. The incident has been logged."})


for router in (
    auth.router,
    market.router,
    watchlists.router,
    alerts.router,
    ml.router,
    strategies.router,
    portfolios.router,
    datasets.router,
    paper.router,
    system.router,
):
    app.include_router(router)


@app.get("/health", tags=["system"])
def health_root():
    return {"status": "ok", "service": "stockpulse-api"}


@app.get("/ready", tags=["system"])
def ready_root():
    from sqlalchemy import text

    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    finally:
        db.close()
    return {"status": "ready", "provider": settings.market_data_provider}


# Serve the built SPA when present (single-container deployment). Development
# uses the Vite dev server with a proxy, so this block is inert there.
from pathlib import Path  # noqa: E402

_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.exists():
    if (_dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="spa-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/") or full_path in {"health", "ready"}:
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        candidate = (_dist / full_path).resolve()
        if str(candidate).startswith(str(_dist.resolve())) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
