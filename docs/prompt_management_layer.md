# Buildspec: File-Based Prompt Management Layer

**Goal**: Move hardcoded system prompts out of `agents/chat.py` into versioned JSON files under `src/agents/app/prompts/`. One file per agent, with named workflow variants. A thin `prompts.py` resolver handles fallback and variable substitution. Langfuse is used for **tracing** (logging which prompt was used and what it produced) — not for storing prompts.

---

## Folder structure

```
src/agents/app/
  prompts/
    chat.json        ← all prompts for the chat agent, by workflow
  prompts.py         ← resolver: load → resolve → compile → (trace)
```

Add more `{agent}.json` files as new agent types are introduced.

---

## 1. `src/agents/app/prompts/chat.json`

Each top-level key is a **workflow**. `"default"` is the base. Other workflows only need to override the slots that differ — the resolver falls back to `"default"` for anything missing.

**Slots per workflow:**

| Slot | When used | Variables |
|---|---|---|
| `with-context` | RAG chunks were retrieved | `{context}` |
| `no-context` | No RAG chunks | _(none)_ |
| `api-tools` | API modules are loaded (appended to either above) | `{modules_json}` |

```json
{
  "default": {
    "with-context": "You are a helpful AI assistant. Answer the user's question using the context below, which was retrieved from their uploaded documents. If the answer cannot be found in the context, say so clearly rather than guessing.\n\n## Retrieved context\n{context}\n\n## Capabilities & Constraints\n- You can communicate in natural language.\n- You do NOT have direct access to execute or trigger external API actions, database operations, or third-party webhooks yourself.\n- If the user asks you to perform an action (e.g., creating a ticket, triggering a webhook, changing settings, executing a task):\n  * If a matching action is listed under the \"Available API Actions\" section, you MUST propose that action using the structured JSON format (Format 2).\n  * If NO matching action is listed under the \"Available API Actions\" section (or if the section is missing entirely), you MUST NOT pretend, assume, role-play, or claim that you have executed or completed the action. Instead, politely inform the user that the required API tool is not currently configured or is unavailable.",

    "no-context": "You are a helpful AI assistant.\n\n## Capabilities & Constraints\n- You can communicate in natural language.\n- You do NOT have direct access to execute or trigger external API actions, database operations, or third-party webhooks yourself.\n- If the user asks you to perform an action (e.g., creating a ticket, triggering a webhook, changing settings, executing a task):\n  * If a matching action is listed under the \"Available API Actions\" section, you MUST propose that action using the structured JSON format (Format 2).\n  * If NO matching action is listed under the \"Available API Actions\" section (or if the section is missing entirely), you MUST NOT pretend, assume, role-play, or claim that you have executed or completed the action. Instead, politely inform the user that the required API tool is not currently configured or is unavailable.",

    "api-tools": "\n\n## Available API Actions\nYou have access to the following API actions that you can propose when the user's request clearly requires one. Only propose an action when ALL required fields from the schema are present in the conversation. If any field is missing, ask the user for it normally instead of proposing.\n\nAvailable actions:\n{modules_json}\n\n## Response format\nYou MUST respond with a single JSON object in one of two formats:\n\nFormat 1 — normal response:\n{{\"type\": \"chat_response\", \"message\": \"Your response here\"}}\n\nFormat 2 — propose an API action:\n{{\"type\": \"api_task_proposal\", \"api_module_id\": \"<uuid>\", \"title\": \"<short title>\", \"description\": \"<what this will do>\", \"input_payload\": {{<field: value pairs from the schema>}}}}\n\nImportant rules:\n- Respond ONLY with the JSON object. No surrounding text.\n- For Format 2, input_payload must include every field from the module's request_schema.\n- Never guess field values — if information is missing, use Format 1 to ask.\n- Never include auth credentials, tokens, or URLs in your response."
  },

  "cost-seg": {
    "with-context": "You are a cost segregation specialist. Use the retrieved documents below to answer questions about IRS MACRS asset classification. Be precise about asset lives, recovery periods, and applicable tax code sections.\n\n## Retrieved context\n{context}\n\n## Capabilities & Constraints\n- You can communicate in natural language.\n- You do NOT have direct access to execute or trigger external API actions, database operations, or third-party webhooks yourself.\n- If the user asks you to perform an action (e.g., creating a ticket, triggering a webhook, changing settings, executing a task):\n  * If a matching action is listed under the \"Available API Actions\" section, you MUST propose that action using the structured JSON format (Format 2).\n  * If NO matching action is listed under the \"Available API Actions\" section (or if the section is missing entirely), you MUST NOT pretend, assume, role-play, or claim that you have executed or completed the action. Instead, politely inform the user that the required API tool is not currently configured or is unavailable.",

    "no-context": "You are a cost segregation specialist. Answer questions about IRS MACRS asset classification, recovery periods, and applicable tax code sections.\n\n## Capabilities & Constraints\n- You can communicate in natural language.\n- You do NOT have direct access to execute or trigger external API actions, database operations, or third-party webhooks yourself.\n- If the user asks you to perform an action (e.g., creating a ticket, triggering a webhook, changing settings, executing a task):\n  * If a matching action is listed under the \"Available API Actions\" section, you MUST propose that action using the structured JSON format (Format 2).\n  * If NO matching action is listed under the \"Available API Actions\" section (or if the section is missing entirely), you MUST NOT pretend, assume, role-play, or claim that you have executed or completed the action. Instead, politely inform the user that the required API tool is not currently configured or is unavailable."
  }
}
```

> **Note**: `cost-seg` does not override `api-tools` — the resolver will fall back to `default.api-tools` automatically.

---

## 2. `src/agents/app/prompts.py`

Replaces the hardcoded prompt strings. No external service dependency.

```python
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
def _load_agent_prompts(agent: str) -> dict:
    path = _PROMPTS_DIR / f"{agent}.json"
    with path.open() as f:
        return json.load(f)


# ── Langfuse tracer (optional, lazy) ─────────────────────────────────────────

_langfuse = None


def _get_langfuse():
    global _langfuse
    if _langfuse is None and settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY:
        from langfuse import Langfuse
        _langfuse = Langfuse(
            public_key=settings.LANGFUSE_PUBLIC_KEY,
            secret_key=settings.LANGFUSE_SECRET_KEY,
            host=settings.LANGFUSE_HOST,
        )
    return _langfuse


def trace_generation(trace_id: str, prompt_name: str, input_messages: list, output: str) -> None:
    """Log a completed LLM generation to Langfuse. No-op if Langfuse is not configured."""
    lf = _get_langfuse()
    if lf is None:
        return
    try:
        trace = lf.trace(id=trace_id, name=prompt_name)
        trace.generation(
            name=prompt_name,
            input=input_messages,
            output=output,
            metadata={"prompt_name": prompt_name},
        )
        lf.flush()
    except Exception:
        logger.warning("Langfuse trace failed — continuing without tracing", exc_info=True)


# ── Public API ────────────────────────────────────────────────────────────────

def get_prompt(agent: str, slot: str, workflow: str | None = None, **variables: str) -> str:
    """
    Resolve and compile a prompt.

    Args:
        agent:    name of the JSON file without extension (e.g. "chat")
        slot:     prompt key within the workflow (e.g. "with-context")
        workflow: workflow variant; falls back to DEFAULT_PROMPT_WORKFLOW then "default"
        **variables: template substitutions (e.g. context="...", modules_json="...")
    """
    workflow = workflow or settings.DEFAULT_PROMPT_WORKFLOW
    prompts = _load_agent_prompts(agent)

    # Try requested workflow first, then "default"
    candidates = [workflow] if workflow == "default" else [workflow, "default"]
    template: str | None = None
    resolved_via: str = ""

    for w in candidates:
        bucket = prompts.get(w, {})
        if slot in bucket:
            template = bucket[slot]
            resolved_via = f"{agent}/{w}/{slot}"
            break

    if template is None:
        raise KeyError(f"Prompt not found: {agent}/{workflow}/{slot} (also tried 'default')")

    logger.debug("Resolved prompt %s", resolved_via)
    return template.format(**variables) if variables else template
```

---

## 3. Environment variables

Add to `.env.example` and `.env`:

```env
# Prompt workflow (matches a top-level key in prompts/{agent}.json)
DEFAULT_PROMPT_WORKFLOW=default

# Langfuse — optional, for LLM call tracing only
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com
```

Add to `src/agents/app/config.py` inside `class Settings`:

```python
DEFAULT_PROMPT_WORKFLOW: str = "default"
LANGFUSE_PUBLIC_KEY: str = ""
LANGFUSE_SECRET_KEY: str = ""
LANGFUSE_HOST: str = "https://cloud.langfuse.com"
```

---

## 4. Update `src/agents/app/agents/chat.py`

### 4a. Delete the hardcoded prompt constants

Remove `_CORE_INSTRUCTIONS`, `_SYSTEM_WITH_CONTEXT`, `_SYSTEM_NO_CONTEXT`, `_API_TOOLS_APPENDIX`.

### 4b. Update `run_agent`

```python
from app.prompts import get_prompt, trace_generation

async def run_agent(
    *,
    conversation: list[dict],
    context_chunks: list[dict],
    api_modules: list[dict],
    redis: aioredis.Redis,
    channel: str,
    workflow: str | None = None,      # <-- new
    trace_id: str | None = None,      # <-- new (optional Langfuse trace ID)
) -> AgentResult:
    if context_chunks:
        context = "\n\n---\n\n".join(
            f"[{c['filename']}]\n{c['content']}" for c in context_chunks
        )
        system_prompt = get_prompt("chat", "with-context", workflow, context=context)
    else:
        system_prompt = get_prompt("chat", "no-context", workflow)

    has_api_modules = bool(api_modules)
    if has_api_modules:
        system_prompt += get_prompt(
            "chat", "api-tools", workflow,
            modules_json=json.dumps(api_modules, indent=2),
        )

    # ... run LLM (unchanged) ...

    # After LLM returns `raw`:
    if trace_id:
        trace_generation(trace_id, f"chat/{workflow or 'default'}", conversation, raw)

    # ... rest of function unchanged
```

---

## 5. Update `src/agents/app/jobs/chat.py`

```python
import uuid

async def run_chat(
    ctx: dict[str, Any],
    *,
    task_id: str,
    org_id: str,
    user_id: str,
    session_id: str,
    message: str,
    user_role: str = "",
    workflow: str | None = None,      # <-- new
) -> None:
    ...
    result = await run_agent(
        conversation=conversation,
        context_chunks=chunks,
        api_modules=api_modules,
        redis=redis,
        channel=channel,
        workflow=workflow,
        trace_id=str(uuid.uuid4()),   # ties Langfuse trace to this job run
    )
```

The server enqueues `run_chat` — pass `workflow` from the chat session's metadata or the request body. No server changes needed to ship; `None` uses `DEFAULT_PROMPT_WORKFLOW`.

---

## 6. Adding a new workflow

1. Add a new top-level key to `prompts/chat.json` with only the slots that differ:
   ```json
   "my-workflow": {
     "no-context": "Custom persona prompt here..."
   }
   ```
2. Set `DEFAULT_PROMPT_WORKFLOW=my-workflow` in `.env`, or pass `workflow="my-workflow"` per request.
3. `with-context` and `api-tools` will automatically fall back to `default`.

---

## Runtime prompt switching

| Method | How |
|---|---|
| Per-deployment default | `DEFAULT_PROMPT_WORKFLOW=cost-seg` in `.env` |
| Per-request | Server passes `workflow=` when enqueuing `run_chat` |
| Edit a prompt | Edit JSON file → redeploy (or restart worker if running locally) |
| Add a workflow | Add key to JSON file → set workflow in config or per-request |

---

## Testing

```bash
cd src/agents

# Verify resolver finds the prompt
python -c "
from app.prompts import get_prompt
print(get_prompt('chat', 'no-context', 'default'))
print('---')
print(get_prompt('chat', 'with-context', 'cost-seg', context='TEST CONTEXT'))
"

# Verify fallback: cost-seg inherits default api-tools
python -c "
from app.prompts import get_prompt
print(get_prompt('chat', 'api-tools', 'cost-seg', modules_json='[]'))
"
```
