from typing import Any, AsyncIterator, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
import json
from app.core.rbac import authorize
from app.core.redis import subscribe, task_channel
from app.core.tenancy import RequestContext
from app.models.agent_task import AgentTaskType
from app.services.agent_tasks import create_task, get_task, list_tasks

router = APIRouter(prefix="/api/agents", tags=["agents"])


class CreateTaskRequest(BaseModel):
    type: str = "text_to_sql"
    question: Optional[str] = None
    project_id: Optional[str] = None
    line_items: Optional[list[dict[str, Any]]] = None


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

    # Build input data
    input_data = {}
    if body.question is not None:
        input_data["question"] = body.question
    if body.project_id is not None:
        input_data["project_id"] = body.project_id
    if body.line_items is not None:
        input_data["line_items"] = body.line_items

    # Create task record
    task = await create_task(
        session,
        org_id=ctx.org_id,
        user_id=ctx.user_id,
        task_type=task_type,
        input_data=input_data,
    )

    # Enqueue Arq job
    from app.core.config import settings
    from arq.connections import create_pool, RedisSettings

    try:
        redis_conn = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        if task_type == AgentTaskType.TEXT_TO_SQL:
            if not body.question:
                raise HTTPException(status_code=400, detail="question is required for text_to_sql")
            await redis_conn.enqueue_job(
                "run_text_to_sql",
                task_id=str(task.id),
                org_id=str(ctx.org_id),
                user_id=str(ctx.user_id),
                question=body.question,
            )
        elif task_type == AgentTaskType.COST_SEG_EXTRACTION:
            if not body.project_id:
                raise HTTPException(status_code=400, detail="project_id is required for cost_seg_extraction")
            await redis_conn.enqueue_job(
                "run_extraction",
                task_id=str(task.id),
                org_id=str(ctx.org_id),
                project_id=body.project_id,
            )
        elif task_type == AgentTaskType.COST_SEG_CLASSIFICATION:
            if not body.project_id:
                raise HTTPException(status_code=400, detail="project_id is required for cost_seg_classification")
            await redis_conn.enqueue_job(
                "run_classification",
                task_id=str(task.id),
                org_id=str(ctx.org_id),
                project_id=body.project_id,
                line_items=body.line_items,
            )
        elif task_type == AgentTaskType.COST_SEG_REPORT:
            if not body.project_id:
                raise HTTPException(status_code=400, detail="project_id is required for cost_seg_report")
            await redis_conn.enqueue_job(
                "run_report",
                task_id=str(task.id),
                org_id=str(ctx.org_id),
                project_id=body.project_id,
            )
        await redis_conn.aclose()
    except HTTPException:
        raise
    except Exception as e:
        from app.core.logging import get_logger
        get_logger(__name__).error("Failed to enqueue task", task_id=str(task.id), error=str(e))

    return _task_to_response(task)


class CostSegTaskRequest(BaseModel):
    project_id: str


@router.post("/tasks/cost_seg", response_model=TaskResponse, status_code=202)
@router.post("/tasks/cost-seg", response_model=TaskResponse, status_code=202)
async def create_cost_seg_pipeline(
    body: CostSegTaskRequest,
    ctx: RequestContext = authorize("agents:execute"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Create a cost segregation pipeline task and enqueue it for processing.
    """
    task = await create_task(
        session,
        org_id=ctx.org_id,
        user_id=ctx.user_id,
        task_type=AgentTaskType.COST_SEG_EXTRACTION,
        input_data={"project_id": body.project_id},
    )

    from app.core.config import settings
    from arq.connections import create_pool, RedisSettings

    try:
        redis_conn = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        await redis_conn.enqueue_job(
            "run_extraction",
            task_id=str(task.id),
            org_id=str(ctx.org_id),
            project_id=body.project_id,
        )
        await redis_conn.aclose()
    except Exception as e:
        from app.core.logging import get_logger
        get_logger(__name__).error("Failed to enqueue cost seg extraction task", task_id=str(task.id), error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

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

    To avoid the race condition where the worker finishes before the subscription
    is active, we subscribe to the channel first, then check the DB.  If the task
    is already terminal we yield a synthetic event and drain.
    """
    # Verify task exists and belongs to this org
    task = await get_task(session, task_id)

    channel = task_channel(str(ctx.org_id), str(task_id))

    async def event_stream() -> AsyncIterator[str]:
        from app.core.redis import get_redis
        from app.core.db import db_session
        from app.services.agent_tasks import get_task as get_task_db

        redis = await get_redis()
        pubsub = redis.pubsub()
        await pubsub.subscribe(channel)

        try:
            # Now that we are subscribed, check if the task already finished
            try:
                async with db_session(ctx.org_id) as sess:
                    current_task = await get_task_db(sess, task_id)
                    if current_task.status == "succeeded":
                        yield f"data: {json.dumps({'type': 'done'})}\n\n"
                        return
                    elif current_task.status == "failed":
                        yield f"data: {json.dumps({'type': 'error', 'data': current_task.error or 'Task failed'})}\n\n"
                        return
            except Exception as e:
                from app.core.logging import get_logger
                get_logger(__name__).warning("Initial task status check failed in stream", error=str(e))

            # Task is still running — relay Redis events
            async for raw_message in pubsub.listen():
                if await request.is_disconnected():
                    break
                if raw_message["type"] == "message":
                    try:
                        data = json.loads(raw_message["data"])
                        yield f"data: {json.dumps(data)}\n\n"
                        if data.get("type") in ("done", "error"):
                            break
                    except (json.JSONDecodeError, KeyError):
                        continue
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
