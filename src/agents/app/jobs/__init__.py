import httpx
import redis.asyncio as aioredis
from arq.connections import RedisSettings

from app.config import settings
from app.jobs.chat import run_chat
from app.jobs.ingest import ingest_document
from app.jobs.api_tool import run_api_tool
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


async def startup(ctx: dict) -> None:
    ctx["redis"] = aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True,
    )
    ctx["http"] = httpx.AsyncClient(
        base_url=settings.SERVER_URL,
        headers={"X-Internal-Secret": settings.SECRET_KEY},
        timeout=30.0,
    )


async def shutdown(ctx: dict) -> None:
    try:
        await ctx["redis"].aclose()
    except (RuntimeError, asyncio.CancelledError):
        # If the worker is stopping during event-loop teardown, ignore close errors.
        pass
    except Exception:
        pass

    try:
        await ctx["http"].aclose()
    except (RuntimeError, asyncio.CancelledError):
        pass
    except Exception:
        pass


class WorkerSettings:
    functions = [run_chat, ingest_document, run_api_tool]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 20
    job_timeout = 300
    keep_result = 3600
