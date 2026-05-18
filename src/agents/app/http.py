"""httpx helpers for calling the server's internal API."""
from typing import Any

import httpx


async def save_assistant_message(
    client: httpx.AsyncClient,
    session_id: str,
    org_id: str,
    content: str,
    sources: list[dict] | None = None,
) -> None:
    resp = await client.post(
        f"/internal/chat/{session_id}/messages",
        json={"org_id": org_id, "role": "assistant", "content": content, "sources": sources},
    )
    resp.raise_for_status()


async def update_task(
    client: httpx.AsyncClient,
    task_id: str,
    org_id: str,
    task_status: str,
    output: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    resp = await client.patch(
        f"/internal/tasks/{task_id}",
        json={"org_id": org_id, "task_status": task_status, "output": output, "error": error},
    )
    resp.raise_for_status()


async def load_api_modules(client: httpx.AsyncClient, org_id: str) -> list[dict]:
    """
    Load enabled API modules for the org — safe metadata only (no auth_config).
    Returns an empty list if the feature is unavailable or no modules are configured.
    Failures are non-fatal: the chat job continues without API tool proposals.
    """
    try:
        resp = await client.get("/internal/api-modules", params={"org_id": org_id})
        if resp.status_code == 200:
            return resp.json().get("data", [])
    except Exception as exc:  # noqa: BLE001
        # Non-fatal: degrade gracefully so the chat job keeps running.
        # The LLM will receive no API modules and behave as a plain chat assistant.
        import logging
        logging.getLogger(__name__).warning("Could not load API modules for org %s: %s", org_id, exc)
    return []


async def create_api_proposal(
    client: httpx.AsyncClient,
    session_id: str,
    org_id: str,
    task_id: str | None,
    proposal: dict,
    auto_accept: bool = False,
) -> str:
    """
    POST /internal/api-task-proposals and return the created proposal_id.
    Raises RuntimeError with the response body if the server returns a non-2xx status.
    """
    resp = await client.post(
        "/internal/api-task-proposals",
        json={
            "org_id": org_id,
            "chat_session_id": session_id,
            "agent_task_id": task_id,
            "api_module_id": proposal["api_module_id"],
            "title": proposal["title"],
            "description": proposal.get("description"),
            "input_payload": proposal.get("input_payload", {}),
            "auto_accept": auto_accept,
        },
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(
            f"Failed to save API proposal (HTTP {resp.status_code}): {resp.text[:500]}"
        )
    return resp.json()["id"]


async def update_execution_log(
    client: httpx.AsyncClient,
    execution_id: str,
    org_id: str,
    *,
    exec_status: str,
    http_status: int | None = None,
    request_payload: dict | None = None,
    response_payload: dict | None = None,
    error: str | None = None,
    proposal_status: str | None = None,
) -> None:
    """PATCH /internal/api-executions/{id} — write back results from the API tool worker."""
    resp = await client.patch(
        f"/internal/api-executions/{execution_id}",
        json={
            "org_id": org_id,
            "status": exec_status,
            "http_status": http_status,
            "request_payload": request_payload,
            "response_payload": response_payload,
            "error": error,
            "proposal_status": proposal_status,
        },
    )
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(
            f"Failed to update execution log {execution_id} (HTTP {resp.status_code}): {resp.text[:500]}"
        )


async def load_api_proposal(
    client: httpx.AsyncClient, proposal_id: str, org_id: str
) -> dict:
    """Load a proposal and its module for the API tool worker (via internal route)."""
    resp = await client.get(
        f"/internal/api-task-proposals/{proposal_id}",
        params={"org_id": org_id},
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Failed to load proposal {proposal_id} (HTTP {resp.status_code}): {resp.text[:500]}"
        )
    return resp.json()


async def load_api_module_full(
    client: httpx.AsyncClient, module_id: str, org_id: str
) -> dict:
    """Load the FULL module config (including auth_config) for the API tool worker."""
    resp = await client.get(
        f"/internal/api-modules/{module_id}/full",
        params={"org_id": org_id},
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Failed to load API module {module_id} (HTTP {resp.status_code}): {resp.text[:500]}"
        )
    return resp.json()
