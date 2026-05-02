import json
from typing import Any

import redis.asyncio as aioredis
import httpx

from app.agents.chat import build_llm, run_agent
from app.config import settings
from app.http import save_assistant_message, update_task
from app.redis import publish, task_channel
from app.streaming import RedisStreamer


async def run_chat(
    ctx: dict[str, Any],
    *,
    task_id: str,
    org_id: str,
    session_id: str,
    message: str,
) -> None:
    """
    Arq job: run the chat agent and stream tokens back via Redis pub/sub.

    Flow:
      1. Mark task as running
      2. Run LangChain agent — tokens published to Redis via RedisStreamer
      3. Save assistant message via server internal API
      4. Mark task as succeeded and signal [done]
    """
    redis: aioredis.Redis = ctx["redis"]
    http: httpx.AsyncClient = ctx["http"]
    channel = task_channel(org_id, task_id)

    await update_task(http, task_id, org_id, "running")

    try:
        streamer = RedisStreamer(redis, channel)
        llm = build_llm(settings.ANTHROPIC_API_KEY, callbacks=[streamer])
        response = await run_agent(llm, history=[], user_message=message)

        await save_assistant_message(http, session_id, org_id, response)
        await update_task(http, task_id, org_id, "succeeded", output={"content": response})
        await publish(redis, channel, {"type": "done"})

    except Exception as exc:
        await publish(redis, channel, {"type": "error", "data": str(exc)})
        await update_task(http, task_id, org_id, "failed", error=str(exc))
        raise
