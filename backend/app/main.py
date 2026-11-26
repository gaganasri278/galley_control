"""FastAPI entry point for Galley Control (production PostgreSQL & dev SQLite ready)."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text

from app.config import settings
from app.database import db_session, get_database_dialect, init_db
from app.models import MenuItem, Order, Organisation, Outlet, SecurityEvent
from app.routers import (
    admin,
    agents,
    auth,
    catalog,
    dashboard,
    orders,
    organisations,
    qr,
    reviews,
)
from app.seed_data import seed_database

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("galley_control")
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate_production_safety()
    init_db()
    with db_session() as db:
        seed_database(db)
    logger.info(
        "Galley Control started env=%s db_dialect=%s llm_configured=%s demo_mode=%s",
        settings.app_env,
        get_database_dialect(),
        bool(settings.llm_api_key),
        settings.effective_demo_mode,
    )
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Production-Ready Agentic AI Campus Canteen Management Ecosystem",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "static" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Request has been logged."},
    )


@app.get("/api/health")
def health_check():
    """Verify FastAPI server and PostgreSQL/SQLite connectivity."""
    try:
        with db_session() as db:
            db.execute(text("SELECT 1"))
            org_count = db.execute(select(func.count(Organisation.id))).scalar_one()
            outlet_count = db.execute(select(func.count(Outlet.id))).scalar_one()
            item_count = db.execute(select(func.count(MenuItem.id))).scalar_one()
            live_orders = db.execute(
                select(func.count(Order.id)).where(Order.is_sample.is_(False))
            ).scalar_one()
            sec_alerts = db.execute(
                select(func.count(SecurityEvent.id)).where(SecurityEvent.resolved.is_(False))
            ).scalar_one()
            dialect = get_database_dialect()
    except Exception as exc:
        logger.exception("Health check DB error: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"status": "unhealthy", "database": "unreachable"},
        )

    return {
        "status": "ok",
        "service": settings.app_name,
        "version": settings.app_version,
        "environment": settings.app_env,
        "demo_mode": settings.effective_demo_mode,
        "database": f"{dialect}_connected",
        "database_dialect": dialect,
        "llm_mode": "hosted_llm" if settings.llm_api_key else "deterministic_fallback",
        "llm_provider": settings.llm_provider if settings.llm_api_key else "unconfigured",
        "counts": {
            "organisations": org_count,
            "outlets": outlet_count,
            "menu_items": item_count,
            "live_orders": live_orders,
            "open_security_events": sec_alerts,
        },
    }


@app.get("/api/health/ready")
def readiness_probe():
    """Lightweight cloud readiness check."""
    with db_session() as db:
        db.execute(text("SELECT 1"))
    return {"ready": True, "dialect": get_database_dialect()}

app.include_router(auth.router)
app.include_router(organisations.router)
app.include_router(catalog.router)
app.include_router(orders.router)
app.include_router(qr.router)
app.include_router(reviews.router)
app.include_router(agents.router)
app.include_router(dashboard.router)
app.include_router(admin.router)


@app.get("/")
def frontend_root():
    index_file = FRONTEND_DIST / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)
    return {"status": "ok", "service": "galley_control"}


@app.get("/{frontend_path:path}")
def frontend_route(frontend_path: str):
    if frontend_path == "api" or frontend_path.startswith(("api/", "static/")):
        raise HTTPException(status_code=404, detail="Not found")

    index_file = FRONTEND_DIST / "index.html"
    if not index_file.is_file():
        raise HTTPException(status_code=404, detail="Not found")

    frontend_root = FRONTEND_DIST.resolve()
    requested_file = (FRONTEND_DIST / frontend_path).resolve()
    try:
        requested_file.relative_to(frontend_root)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found") from None

    if requested_file.is_file():
        return FileResponse(requested_file)
    return FileResponse(index_file)
