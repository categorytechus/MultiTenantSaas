import json
from typing import Any, AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.rbac import authorize
from app.core.redis import subscribe, task_channel
from app.core.tenancy import RequestContext
from app.models.agent_task import AgentTaskType
from app.services.agent_tasks import create_task, get_task, list_tasks

router = APIRouter(prefix="/api/agents", tags=["agents"])


class CreateTaskRequest(BaseModel):
    type: str = "text_to_sql"
    question: str


class TaskResponse(BaseModel):
    id: str
    type: str
    status: str
    input: Any | None
    output: Any | None
    error: str | None
    created_at: str
    completed_at: str | None


def _task_to_response(task) -> dict:
    return {
        "id": str(task.id),
        "type": task.type,
        "status": task.status,
        "input": task.input,
        "output": task.output,
        "error": task.error,
        "created_at": task.created_at.isoformat(),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }


@router.post("/tasks", response_model=TaskResponse, status_code=202)
async def create_agent_task(
    body: CreateTaskRequest,
    ctx: RequestContext = authorize("agents:execute"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Create an agent task and enqueue it for processing.
    Returns 202 Accepted with the task ID.
    """
    # Validate task type
    try:
        task_type = AgentTaskType(body.type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown task type: {body.type}")

    # Create task record
    task = await create_task(
        session,
        org_id=ctx.org_id,
        user_id=ctx.user_id,
        task_type=task_type,
        input_data={"question": body.question},
    )

    # Enqueue Arq job
    from app.core.config import settings
    from arq.connections import create_pool, RedisSettings

    try:
        redis_conn = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        await redis_conn.enqueue_job(
            "run_text_to_sql",
            task_id=str(task.id),
            org_id=str(ctx.org_id),
            user_id=str(ctx.user_id),
            question=body.question,
        )
        await redis_conn.aclose()
    except Exception as e:
        from app.core.logging import get_logger
        get_logger(__name__).error("Failed to enqueue task", task_id=str(task.id), error=str(e))

    return _task_to_response(task)


@router.get("/tasks", response_model=list[TaskResponse])
async def list_agent_tasks(
    ctx: RequestContext = authorize("agents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """List agent tasks for the current org."""
    tasks = await list_tasks(session, ctx.org_id)
    return [_task_to_response(t) for t in tasks]


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_agent_task(
    task_id: UUID,
    ctx: RequestContext = authorize("agents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Get agent task status."""
    task = await get_task(session, task_id)
    return _task_to_response(task)


@router.get("/tasks/{task_id}/stream")
async def stream_task_events(
    task_id: UUID,
    request: Request,
    ctx: RequestContext = authorize("agents:read"),
    session: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    SSE endpoint: subscribes to Redis Pub/Sub and forwards task events to browser.
    Stops when message type is "done" or "error".
    """
    # Verify task exists and belongs to this org
    task = await get_task(session, task_id)

    channel = task_channel(str(ctx.org_id), str(task_id))

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for message in subscribe(channel):
                if await request.is_disconnected():
                    break
                yield f"data: {json.dumps(message)}\n\n"
                if message.get("type") in ("done", "error"):
                    break
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
