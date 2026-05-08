import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.logging import bind_request_context, clear_request_context, get_logger, setup_logging
from app.core.redis import close_redis, get_redis
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown logic."""
    setup_logging()
    logger.info("Starting application", environment=settings.ENVIRONMENT)

    # Initialize Redis connection
    try:
        redis = await get_redis()
        await redis.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning("Redis not available at startup", error=str(e))

    # Run migrations in development
    if settings.ENVIRONMENT == "development":
        try:
            await _run_migrations()
        except Exception as e:
            logger.warning("Migration failed (non-fatal in dev)", error=str(e))

    yield

    # Shutdown
    logger.info("Shutting down application")
    await close_redis()


async def _run_migrations() -> None:
    """Run Alembic migrations programmatically."""
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
    description="FastAPI backend for Multi-Tenant AI SaaS platform",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next) -> Response:
    """
    Middleware that:
    1. Assigns a unique request_id to every request
    2. Binds it (plus org/user if available) to structlog context
    3. Adds X-Request-ID to response headers
    4. Clears context after request
    """
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


# Health check
@app.get("/health", tags=["health"])
async def health_check() -> dict[str, Any]:
    """Health check endpoint."""
    return {"status": "ok", "environment": settings.ENVIRONMENT}


# Include all routers
from app.api.auth import router as auth_router
from app.api.orgs import router as orgs_router
from app.api.users import router as users_router
from app.api.documents import router as documents_router
from app.api.chat import router as chat_router
from app.api.agents import router as agents_router
from app.api.admin import router as admin_router
from app.api.internal import router as internal_router

app.include_router(auth_router)
app.include_router(orgs_router)
app.include_router(users_router)
app.include_router(documents_router)
app.include_router(chat_router)
app.include_router(agents_router)
app.include_router(admin_router)
app.include_router(internal_router)
