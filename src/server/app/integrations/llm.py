import json
import re
from collections import Counter
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


_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
    "with", "as", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "shall", "should", "may", "might", "can", "could", "it", "this", "that",
    "these", "those", "they", "them", "their", "there", "here", "where",
    "when", "what", "which", "who", "how", "than", "then", "also", "about",
    "into", "over", "after", "before", "between", "through", "during",
    "without", "not", "no", "so", "if", "we", "you", "he", "she", "me",
    "him", "her", "us", "my", "your", "his", "its", "our", "up", "down",
    "out", "more", "some", "any", "all", "each", "other", "such", "very",
    "just", "been", "only", "both", "same", "first", "last", "new", "one",
    "two", "three", "said", "like", "use", "get", "make", "know", "take",
    "see", "come", "think", "look", "want", "give", "well", "even", "back",
    "still", "way", "go", "good", "much", "our", "time", "year", "most",
}


def _fallback_metadata(text: str, filename: str) -> dict:
    # Title: filename without extension, underscores/dashes to spaces
    base = filename.rsplit(".", 1)[0] if "." in filename else filename
    title = re.sub(r"[_\-]+", " ", base).strip().title()

    # Summary: first 300 chars, truncated at word boundary
    stripped = " ".join(text.split())
    if len(stripped) <= 300:
        summary = stripped
    else:
        truncated = stripped[:300]
        last_space = truncated.rfind(" ")
        summary = (truncated[:last_space] if last_space > 0 else truncated) + "…"

    # Keywords: top unique words by frequency, filtered
    words = re.findall(r"[a-zA-Z]+", text.lower())
    filtered = [w for w in words if len(w) >= 4 and w not in _STOP_WORDS]
    top = [word for word, _ in Counter(filtered).most_common(10)]
    keywords = top[:10]

    return {"title": title, "summary": summary, "keywords": keywords}


async def generate_document_metadata(text: str, filename: str) -> dict:
    """
    Generate title, summary, and keywords for a document.
    Uses Claude when ANTHROPIC_API_KEY is set; falls back to heuristics otherwise.
    Returns {"title": str, "summary": str, "keywords": list[str]}.
    """
    if not settings.ANTHROPIC_API_KEY:
        return _fallback_metadata(text, filename)

    client = llm._get_client()
    if client is None:
        return _fallback_metadata(text, filename)

    snippet = text[:3000]
    prompt = (
        f"Analyze this document and respond ONLY with a JSON object (no markdown, no extra text).\n\n"
        f"Filename: {filename}\n\nContent:\n{snippet}\n\n"
        f'Respond exactly: {{"title": "...", "summary": "2-3 sentence summary", "keywords": ["word1", "word2", ...up to 10]}}'
    )

    try:
        response = await client.messages.create(
            model=llm.model,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Strip optional markdown code fences
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
        parsed = json.loads(raw)
        return {
            "title": str(parsed.get("title", "") or ""),
            "summary": str(parsed.get("summary", "") or ""),
            "keywords": [str(k) for k in (parsed.get("keywords") or [])[:10]],
        }
    except Exception:
        logger.warning("LLM metadata generation failed, using fallback", filename=filename)
        return _fallback_metadata(text, filename)
