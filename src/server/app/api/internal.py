"""
Internal API endpoints called by the agents service.
Protected by X-Internal-Secret header (must equal SECRET_KEY).
Not exposed publicly — nginx/load balancer should block /internal/* from outside.
"""
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.config import settings
from app.core.db import db_session
from app.models.api_execution_log import ApiExecutionLog
from app.models.api_module import ApiModule
from app.models.api_task_proposal import ApiTaskProposal
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


# ── API module loader (used by chat worker — returns safe metadata only) ───────

@router.get("/api-modules")
async def list_internal_api_modules(
    org_id: str = Query(...),
    _: None = Depends(_verify_secret),
) -> dict:
    """
    Called by the chat worker to load enabled API modules for an org.
    Returns ONLY safe metadata — no auth_config, base_url, or headers.
    """
    async with db_session(org_id) as session:
        result = await session.execute(
            select(ApiModule)
            .where(
                ApiModule.org_id == UUID(org_id),
                ApiModule.enabled == True,  # noqa: E712
                ApiModule.deleted == False,
            )
            .order_by(ApiModule.name)
        )
        modules = result.scalars().all()
        return {
            "data": [
                {
                    "id": str(m.id),
                    "name": m.name,
                    "description": m.description,
                    "request_schema": m.request_schema,
                    "ask_permission": m.ask_permission,
                }
                for m in modules
            ]
        }


@router.get("/api-modules/{module_id}/full")
async def get_internal_api_module_full(
    module_id: UUID,
    org_id: str = Query(...),
    _: None = Depends(_verify_secret),
) -> dict:
    """
    Called by the API tool worker to load the FULL module config including auth_config.
    Only callable with X-Internal-Secret — never exposed publicly.
    """
    async with db_session(org_id) as session:
        module = await session.get(ApiModule, module_id)
        if not module or str(module.org_id) != org_id or module.deleted:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="API module not found")
        return {
            "id": str(module.id),
            "org_id": str(module.org_id),
            "name": module.name,
            "description": module.description,
            "base_url": module.base_url,
            "method": module.method,
            "endpoint_path": module.endpoint_path,
            "auth_type": module.auth_type,
            "auth_config": module.auth_config,
            "headers": module.headers,
            "request_schema": module.request_schema,
            "enabled": module.enabled,
            "ask_permission": module.ask_permission,
        }


# ── API task proposal creation (called by chat worker) ────────────────────────

class CreateProposalRequest(BaseModel):
    org_id: str
    chat_session_id: str
    agent_task_id: str | None = None
    api_module_id: str
    title: str
    description: str | None = None
    input_payload: dict
    proposed_by: str | None = None
    auto_accept: bool = False


@router.get("/api-task-proposals/{proposal_id}")
async def get_internal_proposal(
    proposal_id: UUID,
    org_id: str = Query(...),
    _: None = Depends(_verify_secret),
) -> dict:
    """Load a proposal by ID (called by the API tool worker before execution)."""
    async with db_session(org_id) as session:
        proposal = await session.get(ApiTaskProposal, proposal_id)
        if not proposal or str(proposal.org_id) != org_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Proposal not found")
        return {
            "id": str(proposal.id),
            "org_id": str(proposal.org_id),
            "chat_session_id": str(proposal.chat_session_id),
            "api_module_id": str(proposal.api_module_id),
            "title": proposal.title,
            "description": proposal.description,
            "input_payload": proposal.input_payload,
            "status": proposal.status,
        }


@router.post("/api-task-proposals", status_code=201)
async def create_internal_proposal(
    body: CreateProposalRequest,
    _: None = Depends(_verify_secret),
) -> dict:
    """Called by the chat worker to persist a structured API task proposal."""
    async with db_session(body.org_id) as session:
        now = datetime.now(timezone.utc)
        status = "accepted" if body.auto_accept else "pending_confirmation"
        
        proposal = ApiTaskProposal(
            org_id=UUID(body.org_id),
            chat_session_id=UUID(body.chat_session_id),
            agent_task_id=UUID(body.agent_task_id) if body.agent_task_id else None,
            api_module_id=UUID(body.api_module_id),
            title=body.title,
            description=body.description,
            input_payload=body.input_payload,
            status=status,
            proposed_by=UUID(body.proposed_by) if body.proposed_by else None,
            decided_at=now if body.auto_accept else None,
            accepted_by=UUID(body.proposed_by) if body.proposed_by and body.auto_accept else None,
        )
        session.add(proposal)
        await session.flush()
        
        execution_id = None
        if body.auto_accept:
            # Create execution log
            execution = ApiExecutionLog(
                org_id=UUID(body.org_id),
                proposal_id=proposal.id,
                api_module_id=proposal.api_module_id,
                status="running",
                started_at=now,
            )
            session.add(execution)
            await session.flush()
            execution_id = str(execution.id)
            
            # Enqueue the API tool worker
            from arq.connections import RedisSettings, create_pool
            arq = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
            await arq.enqueue_job(
                "run_api_tool",
                proposal_id=str(proposal.id),
                execution_id=execution_id,
                org_id=body.org_id,
                session_id=body.chat_session_id,
                task_id=body.agent_task_id,
            )
            await arq.aclose()

        return {"id": str(proposal.id), "execution_id": execution_id}


# ── API execution log update (called by API tool worker) ──────────────────────

class UpdateExecutionRequest(BaseModel):
    org_id: str
    status: str
    http_status: int | None = None
    request_payload: dict | None = None
    response_payload: dict | None = None
    error: str | None = None
    proposal_status: str | None = None   # also update parent proposal if supplied


@router.patch("/api-executions/{execution_id}")
async def update_internal_execution(
    execution_id: UUID,
    body: UpdateExecutionRequest,
    _: None = Depends(_verify_secret),
) -> dict:
    """Called by the API tool worker to write back results to the execution log."""
    async with db_session(body.org_id) as session:
        log = await session.get(ApiExecutionLog, execution_id)
        if not log or str(log.org_id) != body.org_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Execution log not found")

        log.status = body.status
        if body.http_status is not None:
            log.http_status = body.http_status
        if body.request_payload is not None:
            log.request_payload = body.request_payload
        if body.response_payload is not None:
            log.response_payload = body.response_payload
        if body.error is not None:
            log.error = body.error
        log.completed_at = datetime.now(timezone.utc)
        session.add(log)

        if body.proposal_status:
            proposal = await session.get(ApiTaskProposal, log.proposal_id)
            if proposal:
                proposal.status = body.proposal_status
                session.add(proposal)

        await session.flush()
        return {"id": str(log.id), "status": log.status}
