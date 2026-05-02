import json

import redis.asyncio as aioredis
from langchain_core.callbacks import AsyncCallbackHandler


class RedisStreamer(AsyncCallbackHandler):
    """Publishes LangChain LLM tokens to a Redis pub/sub channel."""

    def __init__(self, redis: aioredis.Redis, channel: str) -> None:
        self.redis = redis
        self.channel = channel

    async def on_llm_new_token(self, token: str, **kwargs) -> None:
        await self.redis.publish(self.channel, json.dumps({"type": "token", "data": token}))
