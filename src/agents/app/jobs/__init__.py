import httpx
import redis.asyncio as aioredis
from arq.connections import RedisSettings

from app.config import settings
from app.jobs.chat import run_chat
from app.jobs.ingest import ingest_document


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
    await ctx["redis"].aclose()
    await ctx["http"].aclose()


class WorkerSettings:
    functions = [run_chat, ingest_document]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 20
    job_timeout = 300
    keep_result = 3600
