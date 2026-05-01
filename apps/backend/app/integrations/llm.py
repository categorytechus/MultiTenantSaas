from typing import AsyncIterator

import anthropic

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

MOCK_RESPONSE = "I am a mock AI assistant. Please set ANTHROPIC_API_KEY."


class LLMClient:
    """Anthropic Claude LLM client with streaming support."""

    def __init__(self) -> None:
        self._client: anthropic.AsyncAnthropic | None = None
        self.model = "claude-3-5-sonnet-20241022"

    def _get_client(self) -> anthropic.AsyncAnthropic | None:
        if not settings.ANTHROPIC_API_KEY:
            return None
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        return self._client

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        """Stream tokens from Claude."""
        client = self._get_client()
        if client is None:
            logger.warning("ANTHROPIC_API_KEY not set, returning mock response")
            for word in MOCK_RESPONSE.split(" "):
                yield word + " "
            return

        # Separate system message from conversation messages
        system_msg = None
        conversation = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg["content"]
            else:
                conversation.append(msg)

        kwargs: dict = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": conversation,
        }
        if system_msg:
            kwargs["system"] = system_msg

        async with client.messages.stream(**kwargs) as stream:
            async for text in stream.text_stream:
                yield text

    async def complete(self, messages: list[dict]) -> str:
        """Single (non-streaming) completion from Claude."""
        client = self._get_client()
        if client is None:
            logger.warning("ANTHROPIC_API_KEY not set, returning mock response")
            return MOCK_RESPONSE

        system_msg = None
        conversation = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg["content"]
            else:
                conversation.append(msg)

        kwargs: dict = {
            "model": self.model,
            "max_tokens": 4096,
            "messages": conversation,
        }
        if system_msg:
            kwargs["system"] = system_msg

        response = await client.messages.create(**kwargs)
        return response.content[0].text


# Module-level singleton
llm = LLMClient()
