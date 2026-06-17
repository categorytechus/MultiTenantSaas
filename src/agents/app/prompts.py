"""
Prompt resolver.

Loads prompts from src/agents/app/prompts/{agent}.json.
Resolution order for get_prompt(agent, slot, workflow):
  1. prompts/{agent}.json → workflow → slot
  2. prompts/{agent}.json → "default" → slot
  3. KeyError (fail loudly — missing prompt files are a bug, not a runtime condition)

Langfuse tracing is optional: set LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY
to log which prompt was resolved and what the LLM returned.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"


# ── File loading (process-level cache) ───────────────────────────────────────

@lru_cache(maxsize=16)
def _load_prompts() -> dict:
    path = _PROMPTS_DIR / "chat.json"
    with path.open() as f:
        return json.load(f)


@lru_cache(maxsize=16)
def _load_system_prompts() -> dict:
    path = _PROMPTS_DIR / "chat_system.json"
    if path.exists():
        with path.open() as f:
            return json.load(f)
    return {}


# ── Langfuse tracer (optional, lazy) ─────────────────────────────────────────

_langfuse_initialized = False


def _ensure_langfuse():
    """Initialize the Langfuse v4 SDK once. No-op if keys are not set."""
    global _langfuse_initialized
    if _langfuse_initialized:
        return
    _langfuse_initialized = True
    if not settings.LANGFUSE_PUBLIC_KEY or not settings.LANGFUSE_SECRET_KEY:
        return
    try:
        from langfuse import Langfuse
        Langfuse(
            public_key=settings.LANGFUSE_PUBLIC_KEY,
            secret_key=settings.LANGFUSE_SECRET_KEY,
            host=settings.LANGFUSE_HOST,
        )
        logger.info("Langfuse v4 SDK initialized (host=%s)", settings.LANGFUSE_HOST)
    except Exception:
        logger.warning("Langfuse init failed — tracing disabled", exc_info=True)


def trace_generation(trace_id: str, prompt_name: str, input_messages: list, output: str) -> None:
    """Log a completed LLM generation to Langfuse. No-op if Langfuse is not configured."""
    if not settings.LANGFUSE_PUBLIC_KEY or not settings.LANGFUSE_SECRET_KEY:
        return
    _ensure_langfuse()
    try:
        from langfuse import get_client, propagate_attributes
        lf = get_client()

        with propagate_attributes(trace_name=prompt_name, metadata={"trace_id": trace_id}):
            obs = lf.start_observation(
                name=prompt_name,
                as_type="generation",
                input=input_messages,
                output=output,
                metadata={"prompt_name": prompt_name, "trace_id": trace_id},
            )
            obs.end()

        logger.info("Langfuse: trace %s for %s sent", trace_id, prompt_name)
    except Exception:
        logger.warning("Langfuse trace failed — continuing without tracing", exc_info=True)


# ── Public API ────────────────────────────────────────────────────────────────

import string

class SafeFormatter(string.Formatter):
    def get_value(self, key, args, kwargs):
        try:
            return super().get_value(key, args, kwargs)
        except KeyError:
            return "{" + str(key) + "}"

def get_prompt(slot: str, workflow: str | None = None, custom_prompts: dict | None = None, **variables: str) -> str:
    """
    Resolve and compile a prompt.

    Args:
        slot:     prompt key within the workflow (e.g. "with-context")
        workflow: workflow variant; falls back to DEFAULT_PROMPT_WORKFLOW then "default"
        custom_prompts: overrides for prompts loaded from database
        **variables: template substitutions (e.g. context="...", modules_json="...")
    """
    workflow = workflow or settings.DEFAULT_PROMPT_WORKFLOW
    
    candidates = [workflow] if workflow == "default" else [workflow, "default"]
    template: str | None = None
    resolved_via: str = ""
    
    if custom_prompts:
        for w in candidates:
            bucket = custom_prompts.get(w, {})
            if slot in bucket:
                template = bucket[slot]
                resolved_via = f"custom:{w}/{slot}"
                break

    if template is None:
        prompts = _load_prompts()
        for w in candidates:
            bucket = prompts.get(w, {})
            if slot in bucket:
                template = bucket[slot]
                resolved_via = f"file:{w}/{slot}"
                break

    if template is None:
        raise KeyError(f"Prompt not found: {workflow}/{slot} (also tried 'default')")

    # Fetch and append the system prompt
    system_prompts = _load_system_prompts()
    system_template = ""
    for w in candidates:
        bucket = system_prompts.get(w, {})
        if slot in bucket:
            system_template = bucket[slot]
            break
            
    full_template = template + system_template

    logger.debug("Resolved prompt %s", resolved_via)
    if variables:
        formatter = SafeFormatter()
        return formatter.format(full_template, **variables)
    return full_template
