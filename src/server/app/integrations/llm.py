import json
import re
from collections import Counter
from typing import AsyncIterator
import asyncio
from concurrent.futures import ThreadPoolExecutor

import boto3

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

MOCK_RESPONSE = "I am a mock AI assistant. Please set BEDROCK_MODEL_ARN."


class LLMClient:
    """AWS Bedrock Claude LLM client with streaming support."""

    def __init__(self) -> None:
        self._client = None
        self._executor = ThreadPoolExecutor(max_workers=10)

    def _get_client(self):
        if not settings.BEDROCK_MODEL_ARN:
            return None
        if self._client is None:
            kwargs = {"region_name": settings.AWS_BEDROCK_REGION}
            if settings.AWS_ACCESS_KEY_ID:
                kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
            if settings.AWS_SECRET_ACCESS_KEY:
                kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
            if settings.AWS_SESSION_TOKEN:
                kwargs["aws_session_token"] = settings.AWS_SESSION_TOKEN
                
            # Note: Bedrock Runtime doesn't have a native async boto3 client by default
            # unless using aioboto3. We'll use synchronous boto3 and run in threadpool
            self._client = boto3.client("bedrock-runtime", **kwargs)
        return self._client

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        """Stream tokens from Bedrock."""
        client = self._get_client()
        if client is None:
            logger.warning("BEDROCK_MODEL_ARN not set, returning mock response")
            for word in MOCK_RESPONSE.split(" "):
                yield word + " "
                await asyncio.sleep(0.05)
            return

        system_msg = None
        formatted_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg["content"]
            else:
                formatted_messages.append({
                    "role": msg["role"],
                    "content": [{"text": msg["content"]}]
                })

        kwargs = {
            "modelId": settings.BEDROCK_MODEL_ARN,
            "messages": formatted_messages,
        }
        if system_msg:
            kwargs["system"] = [{"text": system_msg}]

        def _invoke_stream():
            return client.converse_stream(**kwargs)

        try:
            response = await asyncio.get_running_loop().run_in_executor(
                self._executor, _invoke_stream
            )
            for event in response.get("stream"):
                if "contentBlockDelta" in event:
                    yield event["contentBlockDelta"]["delta"]["text"]
        except Exception as e:
            logger.error(f"Error streaming from Bedrock: {e}")
            yield f"[Error: {e}]"

    async def complete(self, messages: list[dict]) -> str:
        """Single (non-streaming) completion from Bedrock."""
        client = self._get_client()
        if client is None:
            logger.warning("BEDROCK_MODEL_ARN not set, returning mock response")
            return MOCK_RESPONSE

        system_msg = None
        formatted_messages = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg["content"]
            else:
                formatted_messages.append({
                    "role": msg["role"],
                    "content": [{"text": msg["content"]}]
                })

        kwargs = {
            "modelId": settings.BEDROCK_MODEL_ARN,
            "messages": formatted_messages,
        }
        if system_msg:
            kwargs["system"] = [{"text": system_msg}]

        def _invoke():
            return client.converse(**kwargs)

        try:
            response = await asyncio.get_running_loop().run_in_executor(
                self._executor, _invoke
            )
            return response["output"]["message"]["content"][0]["text"]
        except Exception as e:
            logger.error(f"Error invoking Bedrock: {e}")
            return f"[Error: {e}]"


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
    Uses Bedrock when BEDROCK_MODEL_ARN is set; falls back to heuristics otherwise.
    Returns {"title": str, "summary": str, "keywords": list[str]}.
    """
    if not settings.BEDROCK_MODEL_ARN:
        return _fallback_metadata(text, filename)

    snippet = text[:3000]
    prompt = (
        f"Analyze this document and respond ONLY with a JSON object (no markdown, no extra text).\n\n"
        f"Filename: {filename}\n\nContent:\n{snippet}\n\n"
        f'Respond exactly: {{"title": "...", "summary": "2-3 sentence summary", "keywords": ["word1", "word2", ...up to 10]}}'
    )

    try:
        raw_response = await llm.complete([{"role": "user", "content": prompt}])
        raw = raw_response.strip()
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
    except Exception as e:
        logger.warning(f"LLM metadata generation failed ({e}), using fallback", filename=filename)
        return _fallback_metadata(text, filename)
