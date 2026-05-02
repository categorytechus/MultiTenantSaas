import json
from typing import Any

import redis.asyncio as aioredis


async def publish(redis: aioredis.Redis, channel: str, message: dict[str, Any]) -> None:
    await redis.publish(channel, json.dumps(message))


def task_channel(org_id: str, task_id: str) -> str:
    return f"org:{org_id}:task:{task_id}:events"
