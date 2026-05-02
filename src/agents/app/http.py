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
