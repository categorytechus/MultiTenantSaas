import json

import redis.asyncio as aioredis


class RedisStreamer:
    """Publishes tokens to a Redis pub/sub channel."""

    def __init__(self, redis: aioredis.Redis, channel: str) -> None:
        self.redis = redis
        self.channel = channel

    async def publish_token(self, token: str) -> None:
        await self.redis.publish(self.channel, json.dumps({"type": "token", "data": token}))
