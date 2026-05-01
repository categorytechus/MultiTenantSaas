import json
from typing import AsyncIterator, Any

import redis.asyncio as aioredis

from app.core.config import settings

_redis_client: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    """Returns a singleton Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


async def close_redis() -> None:
    """Close the Redis connection."""
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None


async def publish(channel: str, message: dict[str, Any]) -> None:
    """Publish a JSON message to a Redis Pub/Sub channel."""
    redis = await get_redis()
    await redis.publish(channel, json.dumps(message))


async def subscribe(channel: str) -> AsyncIterator[dict[str, Any]]:
    """
    Async generator that yields messages from a Redis Pub/Sub channel.
    Yields parsed JSON dicts.
    """
    redis = await get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel)

    try:
        async for raw_message in pubsub.listen():
            if raw_message["type"] == "message":
                try:
                    data = json.loads(raw_message["data"])
                    yield data
                    # Stop if done or error
                    if data.get("type") in ("done", "error"):
                        break
                except (json.JSONDecodeError, KeyError):
                    continue
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()


def task_channel(org_id: str, task_id: str) -> str:
    """Returns the Redis Pub/Sub channel name for a task."""
    return f"org:{org_id}:task:{task_id}:events"
