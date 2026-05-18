"""
API Task Proposal routes — accept, decline, and list proposals.
"""
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from arq.connections import RedisSettings, create_pool
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.audit import log_action
from app.core.config import settings
from app.core.db import db_session, get_db
from app.core.redis import get_redis, task_channel
from app.core.tenancy import RequestContext, get_required_context
from app.models.api_execution_log import ApiExecutionLog
from app.models.api_task_proposal import ApiTaskProposal
from app.services.chat import save_message

_log = logging.getLogger(__name__)

router = APIRouter(tags=["api-proposals"])


async def _call_llm(prompt: str) -> str | None:
    """
    Call the configured LLM (determined by CHAT_MODEL) and return the text
    response, or None if the call fails.
    """
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
            _log.warning("_call_llm Gemini failed: %s", exc)

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
            _log.warning("_call_llm OpenAI failed: %s", exc)

    elif model == "bedrock":
        try:
            import asyncio, boto3, json as _json
            def _bedrock_call() -> str:
                client_kwargs = {"region_name": settings.AWS_BEDROCK_REGION}
                if settings.AWS_ACCESS_KEY_ID:
                    client_kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
                if settings.AWS_SECRET_ACCESS_KEY:
                    client_kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
                if settings.AWS_SESSION_TOKEN:
                    client_kwargs["aws_session_token"] = settings.AWS_SESSION_TOKEN
                br = boto3.client("bedrock-runtime", **client_kwargs)
                body = _json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 120,
                    "messages": [{"role": "user", "content": prompt}],
                })
                r = br.invoke_model(modelId=settings.BEDROCK_MODEL_ARN, body=body)
                return _json.loads(r["body"].read())["content"][0]["text"].strip()
            text = await asyncio.get_event_loop().run_in_executor(None, _bedrock_call)
            if text:
                return text
        except Exception as exc:
            _log.warning("_call_llm Bedrock failed: %s", exc)

    else:
        _log.warning("_call_llm: unknown CHAT_MODEL '%s', skipping LLM call", model)

    return None


async def _decline_message(title: str, description: str | None) -> str:
    """Ask the LLM for a natural, conversational decline confirmation."""
    prompt = (
        f"The user just declined an API action you proposed.\n"
        f"Action name: {title}\n"
        f"What it would have done: {description or 'N/A'}\n\n"
        f"Write a single short, friendly sentence (no markdown, no bullet points, "
        f"no technical jargon) acknowledging that the action was cancelled and "
        f"offering to help with something else. Speak in first person as the assistant."
    )
    text = await _call_llm(prompt)
    if text:
        return text
    return f"No problem — I've cancelled the '{title}' action. Let me know if there's anything else I can help with!"


def _proposal_out(p: ApiTaskProposal) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "org_id": str(p.org_id),
        "chat_session_id": str(p.chat_session_id),
        "api_module_id": str(p.api_module_id),
        "title": p.title,
        "description": p.description,
        "input_payload": p.input_payload,
        "status": p.status,
        "created_at": p.created_at.isoformat(),
        "decided_at": p.decided_at.isoformat() if p.decided_at else None,
    }


# ── List proposals for a chat session ─────────────────────────────────────────

@router.get("/api/chat/{session_id}/api-proposals", response_model=None)
async def list_session_proposals(
    session_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    db: AsyncSession = Depends(get_db),
) -> Any:
    result = await db.execute(
        select(ApiTaskProposal)
        .where(
            ApiTaskProposal.chat_session_id == session_id,
            ApiTaskProposal.org_id == ctx.org_id,
        )
        .order_by(ApiTaskProposal.created_at.desc())
    )
    proposals = result.scalars().all()
    return {"success": True, "data": [_proposal_out(p) for p in proposals]}


from pydantic import BaseModel

class AcceptProposalRequest(BaseModel):
    pass

# ── Accept ─────────────────────────────────────────────────────────────────────

@router.post("/api/api-task-proposals/{proposal_id}/accept", response_model=None)
async def accept_proposal(
    proposal_id: UUID,
    body: AcceptProposalRequest = AcceptProposalRequest(),
    ctx: RequestContext = Depends(get_required_context),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    Accept a pending API task proposal.
    1. Validates ownership + status.
    2. Marks proposal as accepted.
    3. Creates an ApiExecutionLog row.
    4. Enqueues run_api_tool on the Arq worker.
    5. Returns execution_id.
    """
    proposal = await db.get(ApiTaskProposal, proposal_id)
    if not proposal or proposal.org_id != ctx.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Proposal not found")

    if proposal.status != "pending_confirmation":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Proposal is already '{proposal.status}' and cannot be accepted",
        )

    # Mark accepted
    now = datetime.now(timezone.utc)
    proposal.status = "accepted"
    proposal.accepted_by = ctx.user_id
    proposal.decided_at = now
    db.add(proposal)


    # Create execution log
    execution = ApiExecutionLog(
        org_id=ctx.org_id,
        proposal_id=proposal.id,
        api_module_id=proposal.api_module_id,
        status="running",
        started_at=now,
    )
    db.add(execution)
    await db.flush()

    await log_action(db, ctx, "api_proposal.accepted", "api_task_proposal",
                     str(proposal.id), {"title": proposal.title,
                                        "execution_id": str(execution.id)})

    if not proposal.agent_task_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Proposal has no associated task_id — cannot route execution result back to browser",
        )

    # Enqueue the API tool worker
    arq = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    await arq.enqueue_job(
        "run_api_tool",
        proposal_id=str(proposal.id),
        execution_id=str(execution.id),
        org_id=str(ctx.org_id),
        session_id=str(proposal.chat_session_id),
        task_id=str(proposal.agent_task_id),
    )
    await arq.aclose()

    return {"success": True, "data": {"execution_id": str(execution.id)}}


# ── Decline ────────────────────────────────────────────────────────────────────

@router.post("/api/api-task-proposals/{proposal_id}/decline", response_model=None)
async def decline_proposal(
    proposal_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    db: AsyncSession = Depends(get_db),
) -> Any:
    """
    Decline a pending API task proposal.
    Saves a short assistant chat message and does NOT enqueue the API worker.
    """
    proposal = await db.get(ApiTaskProposal, proposal_id)
    if not proposal or proposal.org_id != ctx.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Proposal not found")

    if proposal.status != "pending_confirmation":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Proposal is already '{proposal.status}' and cannot be declined",
        )

    now = datetime.now(timezone.utc)
    proposal.status = "declined"
    proposal.declined_by = ctx.user_id
    proposal.decided_at = now
    db.add(proposal)
    await db.flush()

    await log_action(db, ctx, "api_proposal.declined", "api_task_proposal",
                     str(proposal.id), {"title": proposal.title})

    # Persist a chat message so the conversation reflects the decision
    async with db_session(ctx.org_id) as msg_session:
        content = await _decline_message(proposal.title, proposal.description)
        await save_message(
            msg_session,
            chat_id=proposal.chat_session_id,
            org_id=ctx.org_id,
            role="assistant",
            content=content,
        )

    # Publish an event so the chat stream knows the user declined and can close the connection.
    # Must use the same task channel the browser SSE stream is subscribed to.
    if proposal.agent_task_id:
        import json as _json
        redis = await get_redis()
        channel = task_channel(str(ctx.org_id), str(proposal.agent_task_id))
        await redis.publish(
            channel,
            _json.dumps({
                "type": "api_execution_declined",
                "title": proposal.title,
            }),
        )

    return {"success": True}
