"""
Internal API endpoints called by the agents service.
Protected by X-Internal-Secret header (must equal SECRET_KEY).
Not exposed publicly — nginx/load balancer should block /internal/* from outside.
"""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import db_session
from app.services.agent_tasks import update_task_status
from app.services.chat import save_message

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


def _verify_secret(x_internal_secret: str = Header()) -> None:
    if x_internal_secret != settings.SECRET_KEY:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


class SaveMessageRequest(BaseModel):
    org_id: str
    role: str
    content: str
    sources: list[dict] | None = None


class UpdateTaskRequest(BaseModel):
    org_id: str
    task_status: str
    output: dict[str, Any] | None = None
    error: str | None = None


@router.post("/chat/{session_id}/messages", status_code=201)
async def save_agent_message(
    session_id: UUID,
    body: SaveMessageRequest,
    _: None = Depends(_verify_secret),
) -> dict:
    """Called by agents service to persist the assistant reply."""
    async with db_session(body.org_id) as session:
        msg = await save_message(
            session,
            chat_id=session_id,
            org_id=UUID(body.org_id),
            role=body.role,
            content=body.content,
            sources=body.sources,
        )
        return {"id": str(msg.id)}


@router.patch("/tasks/{task_id}")
async def update_agent_task(
    task_id: UUID,
    body: UpdateTaskRequest,
    _: None = Depends(_verify_secret),
) -> dict:
    """Called by agents service to update task status and output."""
    async with db_session(body.org_id) as session:
        task = await update_task_status(
            session,
            task_id=task_id,
            new_status=body.task_status,
            output=body.output,
            error=body.error,
        )
        return {"id": str(task.id), "status": task.status}
