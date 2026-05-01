from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.agent_task import AgentTask, AgentTaskStatus, AgentTaskType
from app.core.logging import get_logger

logger = get_logger(__name__)


async def create_task(
    session: AsyncSession,
    org_id: UUID,
    user_id: UUID,
    task_type: AgentTaskType | str,
    input_data: dict[str, Any] | None = None,
) -> AgentTask:
    """Create a new agent task record."""
    task = AgentTask(
        org_id=org_id,
        user_id=user_id,
        type=task_type.value if isinstance(task_type, AgentTaskType) else task_type,
        status=AgentTaskStatus.PENDING.value,
        input=input_data or {},
    )
    session.add(task)
    await session.flush()
    logger.info("Agent task created", task_id=str(task.id), type=task.type)
    return task


async def get_task(session: AsyncSession, task_id: UUID) -> AgentTask:
    """Get a task by ID. Raises 404 if not found."""
    task = await session.get(AgentTask, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


async def list_tasks(
    session: AsyncSession,
    org_id: UUID,
    user_id: UUID | None = None,
) -> list[AgentTask]:
    """List tasks for an org, optionally filtered by user."""
    query = select(AgentTask).where(AgentTask.org_id == org_id)
    if user_id:
        query = query.where(AgentTask.user_id == user_id)
    query = query.order_by(AgentTask.created_at.desc())
    result = await session.execute(query)
    return list(result.scalars().all())


async def update_task_status(
    session: AsyncSession,
    task_id: UUID | str,
    new_status: AgentTaskStatus | str,
    output: dict[str, Any] | None = None,
    error: str | None = None,
) -> AgentTask:
    """Update the status of an agent task."""
    task_uuid = UUID(str(task_id)) if not isinstance(task_id, UUID) else task_id
    task = await get_task(session, task_uuid)

    if isinstance(new_status, AgentTaskStatus):
        task.status = new_status.value
    else:
        task.status = str(new_status)

    if output is not None:
        task.output = output

    if error is not None:
        task.error = error

    if task.status in (AgentTaskStatus.SUCCEEDED.value, AgentTaskStatus.FAILED.value):
        task.completed_at = datetime.now(timezone.utc)

    session.add(task)
    await session.flush()
    return task
