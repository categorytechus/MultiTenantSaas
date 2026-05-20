"""
Arq job: execute an approved API task proposal.

Security model:
  - All configuration (URL, method, auth) is loaded from the DB-stored ApiModule.
  - The LLM-provided input_payload is validated against the stored request_schema.
  - auth_config is never published to Redis, chat messages, or logs.
  - Response body is truncated to 5 MB before storage.
  - Request timeout is 30 seconds.

Flow:
  1. Load proposal via /internal (verify status == accepted)
  2. Load full ApiModule config via /internal (includes auth_config)
  3. Validate input_payload against request_schema
  4. Build and execute HTTP request using only stored URL/method/auth
  5. Write result back via PATCH /internal/api-executions/{id}
  6. Save assistant chat message with summary
  7. Publish SSE execution result event
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx
import redis.asyncio as aioredis

_log = logging.getLogger(__name__)

from app.http import (
    load_api_module_full,
    load_api_proposal,
    save_assistant_message,
    update_execution_log,
)
from app.redis import publish, task_channel

_MAX_RESPONSE_BYTES = 5 * 1024 * 1024   # 5 MB
_REQUEST_TIMEOUT = 30.0


# ── Payload validation ────────────────────────────────────────────────────────

_COERCE: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "object": dict,
    "array": list,
}


def _validate_payload(payload: dict, schema: dict) -> dict:
    """
    Validate and coerce `payload` against `schema` ({"field": "type"}).
    Raises ValueError with a human-readable message on missing / wrong-type fields.
    """
    coerced: dict = {}
    errors: list[str] = []

    for field, expected_type in schema.items():
        if field not in payload:
            errors.append(f"Missing required field: '{field}'")
            continue
        raw = payload[field]
        python_type = _COERCE.get(str(expected_type).lower())
        if python_type is None:
            coerced[field] = raw  # unknown type — pass through
            continue
        # bool is a subclass of int in Python, so isinstance(True, int) is True.
        # Explicitly reject booleans when the schema expects a numeric type so that
        # LLM-generated True/False values don't silently pass through as 1/0.
        if isinstance(raw, bool) and python_type in (int, float):
            errors.append(
                f"Field '{field}' expected {expected_type}, got bool"
            )
            continue
        if isinstance(raw, python_type):
            coerced[field] = raw
            continue
        # Attempt coercion
        try:
            coerced[field] = python_type(raw)
        except (ValueError, TypeError):
            errors.append(
                f"Field '{field}' expected {expected_type}, got {type(raw).__name__}"
            )

    if errors:
        raise ValueError("; ".join(errors))

    return coerced


# ── Auth injection ────────────────────────────────────────────────────────────

def _inject_auth(headers: dict[str, str], module: dict) -> None:
    """Mutate `headers` in-place. auth_config must never appear in logs."""
    cfg = module.get("auth_config") or {}
    auth_type = module.get("auth_type", "none")

    if auth_type == "bearer":
        token = cfg.get("token", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
    elif auth_type == "basic":
        import base64
        user = cfg.get("username", "")
        pw = cfg.get("password", "")
        encoded = base64.b64encode(f"{user}:{pw}".encode()).decode()
        headers["Authorization"] = f"Basic {encoded}"
    elif auth_type == "api_key":
        key_name = cfg.get("header_name", "X-API-Key")
        key_val = cfg.get("key", "")
        if key_val:
            headers[key_name] = key_val


# ── Main job ──────────────────────────────────────────────────────────────────

async def run_api_tool(
    ctx: dict[str, Any],
    *,
    proposal_id: str,
    execution_id: str,
    org_id: str,
    session_id: str,
    task_id: str,
) -> None:
    """
    Execute an accepted API task proposal.
    Only uses stored ApiModule configuration — never trusts LLM-provided URLs.
    """
    redis: aioredis.Redis = ctx["redis"]
    http: httpx.AsyncClient = ctx["http"]

    # Publish to the same task channel the frontend SSE stream is subscribed to.
    channel = task_channel(org_id, task_id)

    # ── 1. Load proposal ──────────────────────────────────────────────────────
    try:
        proposal = await load_api_proposal(http, proposal_id, org_id)
    except Exception as exc:
        await _fail(http, redis, channel, execution_id, org_id, session_id,
                    proposal_id, f"Failed to load proposal: {exc}", None)
        return

    if proposal["status"] != "accepted":
        # Guard against double-execution
        await _fail(http, redis, channel, execution_id, org_id, session_id,
                    proposal_id, f"Proposal is not in accepted state (got: {proposal['status']})", None)
        return

    # ── 2. Load full module config ─────────────────────────────────────────
    try:
        module = await load_api_module_full(http, proposal["api_module_id"], org_id)
    except Exception as exc:
        await _fail(http, redis, channel, execution_id, org_id, session_id,
                    proposal_id, f"Failed to load API module: {exc}", None)
        return

    if not module.get("enabled", True):
        await _fail(http, redis, channel, execution_id, org_id, session_id,
                    proposal_id, "API module is disabled", None)
        return

    # ── 3. Validate input payload ─────────────────────────────────────────
    try:
        validated_payload = _validate_payload(
            proposal["input_payload"],
            module.get("request_schema", {}),
        )
    except ValueError as exc:
        await _fail(http, redis, channel, execution_id, org_id, session_id,
                    proposal_id, f"Payload validation failed: {exc}", None)
        return

    # ── 4. Build and execute HTTP request ──────────────────────────────────
    url = f"{module['base_url'].rstrip('/')}/{module['endpoint_path'].lstrip('/')}"
    headers: dict[str, str] = {"Content-Type": "application/json", "Accept": "application/json"}
    headers.update(module.get("headers") or {})
    _inject_auth(headers, module)   # adds auth — never stored in logs

    method = module["method"].upper()
    request_meta = {
        "module_name": module["name"],
        "module_description": module["description"],
        "url": url,
        "method": method,
        "payload": validated_payload,
    }

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            if method in {"GET", "DELETE"}:
                resp = await client.request(method, url, headers=headers, params=validated_payload)
            else:
                resp = await client.request(method, url, headers=headers, json=validated_payload)

        # Truncate response body to 5 MB
        raw_body = resp.content[:_MAX_RESPONSE_BYTES]
        try:
            response_payload = resp.json()
        except Exception:
            response_payload = {"raw": raw_body.decode("utf-8", errors="replace")}

        http_status = resp.status_code
        success = 200 <= http_status < 300

    except Exception as exc:
        await _fail(http, redis, channel, execution_id, org_id, session_id,
                    proposal_id, f"HTTP request failed: {exc}", request_meta)
        return

    # ── 5. Write back result ───────────────────────────────────────────────
    if success:
        await update_execution_log(
            http, execution_id, org_id,
            exec_status="succeeded",
            http_status=http_status,
            request_payload=request_meta,
            response_payload=response_payload,
            proposal_status="succeeded",
        )
        summary = await _natural_summary(
            action=proposal["title"],
            description=proposal.get("description", ""),
            input_payload=proposal.get("input_payload", {}),
            response_payload=response_payload,
            success=True,
        )
        await save_assistant_message(http, session_id, org_id, summary)
        await publish(redis, channel, {
            "type": "api_execution_completed",
            "proposal_id": proposal_id,
            "execution_id": execution_id,
            "status": "succeeded",
            "summary": summary,
        })
    else:
        error_msg = f"API returned HTTP {http_status}: {json.dumps(response_payload)[:500]}"
        await update_execution_log(
            http, execution_id, org_id,
            exec_status="failed",
            http_status=http_status,
            request_payload=request_meta,
            response_payload=response_payload,
            error=error_msg,
            proposal_status="failed",
        )
        summary = await _natural_summary(
            action=proposal["title"],
            description=proposal.get("description", ""),
            input_payload=proposal.get("input_payload", {}),
            response_payload=response_payload,
            success=False,
        )
        await save_assistant_message(http, session_id, org_id, summary)
        await publish(redis, channel, {
            "type": "api_execution_failed",
            "proposal_id": proposal_id,
            "execution_id": execution_id,
            "error": error_msg,
        })


async def _natural_summary(
    *,
    action: str,
    description: str,
    input_payload: dict,
    response_payload: dict,
    success: bool,
) -> str:
    """
    Ask the LLM to produce a short, conversational confirmation message.
    Falls back to a plain-English string if the LLM call fails.
    """
    from app.config import settings

    outcome = "succeeded" if success else "failed"
    prompt = (
        f"The user asked you to perform the following action and you did it.\n"
        f"Action: {action}\n"
        f"What it does: {description}\n"
        f"Data sent: {json.dumps(input_payload)}\n"
        f"Outcome: {outcome}\n"
        f"API response (truncated): {json.dumps(response_payload)[:400]}\n\n"
        f"Write a single short, friendly sentence (no bullet points, no markdown, "
        f"no technical jargon, no HTTP codes) confirming what just happened to the user. "
        f"Speak in first person as the assistant."
    )

    model = settings.CHAT_MODEL.lower()

    if model == "gemini":
        try:
            from google import genai
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            resp = await client.aio.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=prompt,
            )
            text = (resp.text or "").strip()
            if text:
                return text
        except Exception as exc:
            _log.warning("_natural_summary Gemini failed: %s", exc)

    elif model == "openai":
        try:
            import openai
            client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
            resp = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=120,
            )
            text = (resp.choices[0].message.content or "").strip()
            if text:
                return text
        except Exception as exc:
            _log.warning("_natural_summary OpenAI failed: %s", exc)

    elif model == "bedrock":
        try:
            import asyncio, boto3
            def _bedrock_call() -> str:
                client_kwargs = {"region_name": settings.AWS_BEDROCK_REGION}
                if settings.AWS_ACCESS_KEY_ID:
                    client_kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
                if settings.AWS_SECRET_ACCESS_KEY:
                    client_kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
                if settings.AWS_SESSION_TOKEN:
                    client_kwargs["aws_session_token"] = settings.AWS_SESSION_TOKEN
                br = boto3.client("bedrock-runtime", **client_kwargs)
                body = json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 120,
                    "messages": [{"role": "user", "content": prompt}],
                })
                r = br.invoke_model(modelId=settings.BEDROCK_MODEL_ARN, body=body)
                return json.loads(r["body"].read())["content"][0]["text"].strip()
            text = await asyncio.get_event_loop().run_in_executor(None, _bedrock_call)
            if text:
                return text
        except Exception as exc:
            _log.warning("_natural_summary Bedrock failed: %s", exc)

    else:
        _log.warning("_natural_summary: unknown CHAT_MODEL '%s', skipping LLM call", model)

    # Plain-English fallback
    if success:
        return f"Done! I've successfully completed the '{action}' action for you."
    return f"Something went wrong while trying to '{action}'. Please try again or contact support."


async def _fail(
    http: httpx.AsyncClient,
    redis: aioredis.Redis,
    channel: str,
    execution_id: str,
    org_id: str,
    session_id: str,
    proposal_id: str,
    error: str,
    request_meta: dict | None,
) -> None:
    """Common failure handler — updates DB, posts chat message, publishes SSE."""
    try:
        await update_execution_log(
            http, execution_id, org_id,
            exec_status="failed",
            request_payload=request_meta,
            error=error,
            proposal_status="failed",
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Failed to update execution log during _fail: %s", exc)

    try:
        await save_assistant_message(
            http, session_id, org_id,
            f"❌ API action could not be completed: {error}",
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Failed to save assistant message during _fail: %s", exc)
    await publish(redis, channel, {
        "type": "api_execution_failed",
        "proposal_id": proposal_id,
        "execution_id": execution_id,
        "error": error,
    })
