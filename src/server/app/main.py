import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.logging import bind_request_context, clear_request_context, get_logger, setup_logging
from app.core.redis import close_redis, get_redis

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown logic."""
    setup_logging()
    logger.info("Starting application", environment=settings.ENVIRONMENT)

    try:
        redis = await get_redis()
        await redis.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning("Redis not available at startup", error=str(e))

    if settings.ENVIRONMENT == "development":
        try:
            await _run_migrations()
        except Exception as e:
            logger.warning("Migration failed (non-fatal in dev)", error=str(e))

    # Load DB-backed super admin allowlist.
    try:
        from sqlmodel import select

        from app.core.db import async_session_factory
        from app.core.identity import set_db_super_admin_user_ids
        from app.models.super_admin import SuperAdminAllowlist

        async with async_session_factory() as session:
            result = await session.execute(select(SuperAdminAllowlist.user_id))
            ids = frozenset(result.scalars().all())
            set_db_super_admin_user_ids(ids)
            logger.info("Loaded super admin allowlist", count=len(ids))
    except Exception as e:
        logger.warning("Failed to load super admin allowlist", error=str(e))

    yield

    logger.info("Shutting down application")
    await close_redis()


async def _run_migrations() -> None:
    import asyncio
    from alembic.config import Config
    from alembic import command

    def _run():
        alembic_cfg = Config("alembic.ini")
        alembic_cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
        command.upgrade(alembic_cfg, "head")

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run)
    logger.info("Migrations applied")


app = FastAPI(
    title="Multi-Tenant AI SaaS API",
    version="0.1.0",
    description="FastAPI backend for the Multi-Tenant AI SaaS platform.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next) -> Response:
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    start_time = time.perf_counter()

    bind_request_context(request_id=request_id)

    try:
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.info(
            "Request completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=round(duration_ms, 2),
        )
        response.headers["X-Request-ID"] = request_id
        return response
    except Exception as e:
        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.error(
            "Request failed",
            method=request.method,
            path=request.url.path,
            error=str(e),
            duration_ms=round(duration_ms, 2),
        )
        raise
    finally:
        clear_request_context()


@app.get("/health", tags=["health"])
async def health_check() -> dict[str, Any]:
    """Liveness/readiness probe."""
    return {"status": "ok", "environment": settings.ENVIRONMENT}


from app.api.admin import router as admin_router
from app.api.agents import router as agents_router
from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.documents import router as documents_router
from app.api.internal import router as internal_router
from app.api.organizations import router as organizations_router
from app.api.tenant_org_routes import router as tenant_org_router
from app.api.users import router as users_router
from app.api.web_urls import router as web_urls_router

app.include_router(auth_router)
app.include_router(organizations_router)
app.include_router(tenant_org_router)
app.include_router(users_router)
app.include_router(documents_router)
app.include_router(web_urls_router)
app.include_router(chat_router)
app.include_router(agents_router)
app.include_router(admin_router)
app.include_router(internal_router)
