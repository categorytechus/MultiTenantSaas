"""
LLM client for the agents package.
Routes to Gemini or Bedrock based on the CHAT_MODEL setting.
Mirrors src/server/app/integrations/llm.py but uses agents' app.config.
"""
import asyncio
import json
import logging
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import AsyncIterator

import boto3

from app.config import settings

logger = logging.getLogger(__name__)

MOCK_RESPONSE = "I am a mock AI assistant. Please set BEDROCK_MODEL_ARN or GEMINI_API_KEY."


class BedrockLLMClient:
    def __init__(self) -> None:
        self._client = None
        self._executor = ThreadPoolExecutor(max_workers=10)

    def _get_client(self):
        if not settings.BEDROCK_MODEL_ARN:
            return None
        if self._client is None:
            kwargs: dict = {"region_name": settings.AWS_BEDROCK_REGION}
            if settings.AWS_ACCESS_KEY_ID:
                kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
            if settings.AWS_SECRET_ACCESS_KEY:
                kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
            if settings.AWS_SESSION_TOKEN:
                kwargs["aws_session_token"] = settings.AWS_SESSION_TOKEN
            self._client = boto3.client("bedrock-runtime", **kwargs)
        return self._client

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        client = self._get_client()
        if client is None:
            logger.warning("BEDROCK_MODEL_ARN not set, returning mock response")
            for word in MOCK_RESPONSE.split(" "):
                yield word + " "
                await asyncio.sleep(0.05)
            return

        system_msg = None
        formatted = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg["content"]
            else:
                formatted.append({"role": msg["role"], "content": [{"text": msg["content"]}]})

        kwargs: dict = {"modelId": settings.BEDROCK_MODEL_ARN, "messages": formatted}
        if system_msg:
            kwargs["system"] = [{"text": system_msg}]

        try:
            response = await asyncio.get_running_loop().run_in_executor(
                self._executor, lambda: client.converse_stream(**kwargs)
            )
            for event in response.get("stream"):
                if "contentBlockDelta" in event:
                    yield event["contentBlockDelta"]["delta"]["text"]
        except Exception as exc:
            logger.error("Bedrock stream error: %s", exc)
            yield f"[Error: {exc}]"

    async def complete(self, messages: list[dict]) -> str:
        client = self._get_client()
        if client is None:
            return MOCK_RESPONSE

        system_msg = None
        formatted = []
        for msg in messages:
            if msg.get("role") == "system":
                system_msg = msg["content"]
            else:
                formatted.append({"role": msg["role"], "content": [{"text": msg["content"]}]})

        kwargs: dict = {"modelId": settings.BEDROCK_MODEL_ARN, "messages": formatted}
        if system_msg:
            kwargs["system"] = [{"text": system_msg}]

        try:
            response = await asyncio.get_running_loop().run_in_executor(
                self._executor, lambda: client.converse(**kwargs)
            )
            return response["output"]["message"]["content"][0]["text"]
        except Exception as exc:
            logger.error("Bedrock complete error: %s", exc)
            return f"[Error: {exc}]"


class GeminiLLMClient:
    def __init__(self) -> None:
        self._model = None

    def _get_model(self):
        if not settings.GEMINI_API_KEY:
            return None
        if self._model is None:
            import google.generativeai as genai
            genai.configure(api_key=settings.GEMINI_API_KEY)
            self._model = genai.GenerativeModel(settings.GEMINI_MODEL)
        return self._model

    def _build_contents(self, messages: list[dict]) -> tuple[str | None, list[dict]]:
        system_instruction = None
        contents = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                system_instruction = content
            elif role == "assistant":
                contents.append({"role": "model", "parts": [{"text": content}]})
            else:
                contents.append({"role": "user", "parts": [{"text": content}]})
        return system_instruction, contents

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        import google.generativeai as genai
        model = self._get_model()
        if model is None:
            logger.warning("GEMINI_API_KEY not set, returning mock response")
            for word in MOCK_RESPONSE.split(" "):
                yield word + " "
                await asyncio.sleep(0.05)
            return

        system_instruction, contents = self._build_contents(messages)
        if system_instruction:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            model = genai.GenerativeModel(settings.GEMINI_MODEL, system_instruction=system_instruction)

        try:
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(
                None, lambda: model.generate_content(contents, stream=True)
            )
            for chunk in response:
                text = chunk.text if hasattr(chunk, "text") else ""
                if text:
                    yield text
        except Exception as exc:
            logger.error("Gemini stream error: %s", exc)
            yield f"[Error: {exc}]"

    async def complete(self, messages: list[dict]) -> str:
        import google.generativeai as genai
        model = self._get_model()
        if model is None:
            return MOCK_RESPONSE

        system_instruction, contents = self._build_contents(messages)
        if system_instruction:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            model = genai.GenerativeModel(settings.GEMINI_MODEL, system_instruction=system_instruction)

        try:
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(None, lambda: model.generate_content(contents))
            return response.text
        except Exception as exc:
            logger.error("Gemini complete error: %s", exc)
            return f"[Error: {exc}]"


class LLMClient:
    def __init__(self) -> None:
        self._bedrock = BedrockLLMClient()
        self._gemini = GeminiLLMClient()

    def _backend(self):
        return self._gemini if settings.CHAT_MODEL.lower() == "gemini" else self._bedrock

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        async for token in self._backend().stream(messages):
            yield token

    async def complete(self, messages: list[dict]) -> str:
        return await self._backend().complete(messages)


llm = LLMClient()


# ── Fallback metadata helpers (no LLM) ────────────────────────────────────────

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
    base = filename.rsplit(".", 1)[0] if "." in filename else filename
    title = re.sub(r"[_\-]+", " ", base).strip().title()
    stripped = " ".join(text.split())
    if len(stripped) <= 300:
        summary = stripped
    else:
        truncated = stripped[:300]
        last_space = truncated.rfind(" ")
        summary = (truncated[:last_space] if last_space > 0 else truncated) + "…"
    words = re.findall(r"[a-zA-Z]+", text.lower())
    filtered = [w for w in words if len(w) >= 4 and w not in _STOP_WORDS]
    top = [word for word, _ in Counter(filtered).most_common(10)]
    return {"title": title, "summary": summary, "keywords": top[:10]}


async def generate_document_metadata(text: str, filename: str) -> dict:
    use_gemini = settings.CHAT_MODEL.lower() == "gemini"
    if use_gemini and not settings.GEMINI_API_KEY:
        return _fallback_metadata(text, filename)
    if not use_gemini and not settings.BEDROCK_MODEL_ARN:
        return _fallback_metadata(text, filename)

    snippet = text[:3000]
    prompt = (
        f"Analyze this document and respond ONLY with a JSON object (no markdown, no extra text).\n\n"
        f"Filename: {filename}\n\nContent:\n{snippet}\n\n"
        f'Respond exactly: {{"title": "...", "summary": "2-3 sentence summary", "keywords": ["word1", "word2", ...up to 10]}}'
    )
    try:
        raw = (await llm.complete([{"role": "user", "content": prompt}])).strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
        parsed = json.loads(raw)
        return {
            "title": str(parsed.get("title", "") or ""),
            "summary": str(parsed.get("summary", "") or ""),
            "keywords": [str(k) for k in (parsed.get("keywords") or [])[:10]],
        }
    except Exception as exc:
        logger.warning("LLM metadata generation failed (%s), using fallback", exc)
        return _fallback_metadata(text, filename)
