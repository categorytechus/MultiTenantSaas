import json
import re
from collections import Counter
from typing import AsyncIterator
import asyncio
from concurrent.futures import ThreadPoolExecutor

import boto3
import openai
from google import genai
from google.genai import types

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

MOCK_RESPONSE = "I am a mock AI assistant. Please configure CHAT_MODEL and credentials."


class LLMClient:
    """LLM client routing between Bedrock, OpenAI, and Gemini with streaming support."""

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=10)
        self._bedrock_client = None
        self._openai_client = None
        self._gemini_client = None

    def _get_bedrock_client(self):
        if self._bedrock_client is None:
            kwargs = {"region_name": settings.AWS_BEDROCK_REGION}
            if settings.AWS_ACCESS_KEY_ID:
                kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
            if settings.AWS_SECRET_ACCESS_KEY:
                kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
            if settings.AWS_SESSION_TOKEN:
                kwargs["aws_session_token"] = settings.AWS_SESSION_TOKEN
            self._bedrock_client = boto3.client("bedrock-runtime", **kwargs)
        return self._bedrock_client
        
    def _get_openai_client(self):
        if self._openai_client is None:
            self._openai_client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        return self._openai_client
        
    def _get_gemini_client(self):
        if self._gemini_client is None:
            self._gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)
        return self._gemini_client

    def _is_configured(self) -> bool:
        if settings.CHAT_MODEL == "bedrock" and settings.BEDROCK_MODEL_ARN:
            return True
        if settings.CHAT_MODEL == "openai" and settings.OPENAI_API_KEY:
            return True
        if settings.CHAT_MODEL == "gemini" and settings.GEMINI_API_KEY:
            return True
        return False

    async def stream(self, messages: list[dict]) -> AsyncIterator[str]:
        """Stream tokens from the configured CHAT_MODEL."""
        if not self._is_configured():
            logger.warning(f"CHAT_MODEL ({settings.CHAT_MODEL}) not configured, returning mock response")
            for word in MOCK_RESPONSE.split(" "):
                yield word + " "
                await asyncio.sleep(0.05)
            return

        if settings.CHAT_MODEL == "bedrock":
            system_msg = None
            formatted_messages = []
            for msg in messages:
                if msg.get("role") == "system":
                    system_msg = msg["content"]
                else:
                    formatted_messages.append({"role": msg["role"], "content": [{"text": msg["content"]}]})
            
            kwargs = {"modelId": settings.BEDROCK_MODEL_ARN, "messages": formatted_messages}
            if system_msg:
                kwargs["system"] = [{"text": system_msg}]
            
            client = self._get_bedrock_client()
            def _invoke_stream():
                return client.converse_stream(**kwargs)
            
            try:
                response = await asyncio.get_running_loop().run_in_executor(self._executor, _invoke_stream)
                for event in response.get("stream"):
                    if "contentBlockDelta" in event:
                        yield event["contentBlockDelta"]["delta"]["text"]
            except Exception as e:
                logger.error(f"Error streaming from Bedrock: {e}")
                yield f"[Error: {e}]"

        elif settings.CHAT_MODEL == "openai":
            client = self._get_openai_client()
            
            # Map roles to openai roles
            oai_messages = []
            for msg in messages:
                oai_messages.append({"role": msg.get("role"), "content": msg["content"]})
                
            try:
                stream = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=oai_messages,
                    stream=True,
                )
                async for chunk in stream:
                    if chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content
            except Exception as e:
                logger.error(f"Error streaming from OpenAI: {e}")
                yield f"[Error: {e}]"

        elif settings.CHAT_MODEL == "gemini":
            client = self._get_gemini_client()
            
            system_prompt = next((m["content"] for m in messages if m["role"] == "system"), None)
            contents = [
                {
                    "role": "model" if m["role"] == "assistant" else "user",
                    "parts": [{"text": m["content"]}],
                }
                for m in messages if m["role"] != "system"
            ]
            
            config = types.GenerateContentConfig()
            if system_prompt:
                config.system_instruction = system_prompt
                
            try:
                async for chunk in await client.aio.models.generate_content_stream(
                    model="gemini-2.5-flash",
                    contents=contents,
                    config=config,
                ):
                    if chunk.text:
                        yield chunk.text
            except Exception as e:
                logger.error(f"Error streaming from Gemini: {e}")
                yield f"[Error: {e}]"

    async def complete(self, messages: list[dict]) -> str:
        """Single (non-streaming) completion from the configured CHAT_MODEL."""
        if not self._is_configured():
            logger.warning(f"CHAT_MODEL ({settings.CHAT_MODEL}) not configured, returning mock response")
            return MOCK_RESPONSE

        if settings.CHAT_MODEL == "bedrock":
            system_msg = None
            formatted_messages = []
            for msg in messages:
                if msg.get("role") == "system":
                    system_msg = msg["content"]
                else:
                    formatted_messages.append({"role": msg["role"], "content": [{"text": msg["content"]}]})
            
            kwargs = {"modelId": settings.BEDROCK_MODEL_ARN, "messages": formatted_messages}
            if system_msg:
                kwargs["system"] = [{"text": system_msg}]
            
            client = self._get_bedrock_client()
            def _invoke():
                return client.converse(**kwargs)
            
            try:
                response = await asyncio.get_running_loop().run_in_executor(self._executor, _invoke)
                return response["output"]["message"]["content"][0]["text"]
            except Exception as e:
                logger.error(f"Error invoking Bedrock: {e}")
                return f"[Error: {e}]"
                
        elif settings.CHAT_MODEL == "openai":
            client = self._get_openai_client()
            
            oai_messages = [{"role": msg.get("role"), "content": msg["content"]} for msg in messages]
            try:
                response = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=oai_messages,
                )
                return response.choices[0].message.content or ""
            except Exception as e:
                logger.error(f"Error invoking OpenAI: {e}")
                return f"[Error: {e}]"
                
        elif settings.CHAT_MODEL == "gemini":
            client = self._get_gemini_client()
            
            system_prompt = next((m["content"] for m in messages if m["role"] == "system"), None)
            contents = [
                {
                    "role": "model" if m["role"] == "assistant" else "user",
                    "parts": [{"text": m["content"]}],
                }
                for m in messages if m["role"] != "system"
            ]
            
            config = types.GenerateContentConfig()
            if system_prompt:
                config.system_instruction = system_prompt
                
            try:
                response = await client.aio.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=contents,
                    config=config,
                )
                return response.text or ""
            except Exception as e:
                logger.error(f"Error invoking Gemini: {e}")
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
    Uses the configured CHAT_MODEL; falls back to heuristics otherwise.
    Returns {"title": str, "summary": str, "keywords": list[str]}.
    """
    if not llm._is_configured():
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
