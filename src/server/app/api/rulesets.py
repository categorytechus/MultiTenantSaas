"""
CRUD endpoints for workflow classification rulesets.

Rulesets guide the LLM during asset classification. They can be plain text
(a paragraph of rules) or JSON — stored as-is and passed verbatim to the LLM.

Each ruleset is scoped to an organization. Both super_admin and org_admin can
manage rulesets for the org they are currently operating in.

GET    /api/rulesets                   — list rulesets for current org
POST   /api/rulesets                   — upload ruleset (super_admin or org_admin)
PUT    /api/rulesets/{id}              — replace ruleset file (super_admin or org_admin)
DELETE /api/rulesets/{id}              — delete ruleset (super_admin or org_admin)
GET    /api/rulesets/{id}/download     — download the file (super_admin or org_admin)
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import db_session, get_db
from app.core.logging import get_logger
from app.core.rbac import authorize
from app.core.tenancy import RequestContext
from app.integrations.s3 import (
    _is_local_mode,
    _local_path,
    delete as s3_delete,
    presigned_get,
    upload as s3_upload,
)
from app.models.ruleset import CostSegRuleset

router = APIRouter(prefix="/api/rulesets", tags=["rulesets"])
logger = get_logger(__name__)

MAX_SIZE = 10 * 1024 * 1024  # 10 MB


def _to_dict(r: CostSegRuleset) -> dict:
    return {
        "id": str(r.id),
        "org_id": str(r.org_id) if r.org_id else None,
        "workflow_type": r.workflow_type,
        "filename": r.filename,
        "s3_key": r.s3_key,
        "size_bytes": r.size_bytes,
        "status": r.status,
        "created_at": r.created_at.isoformat(),
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _require_admin(ctx: RequestContext) -> None:
    if ctx.role not in ("super_admin", "org_admin"):
        raise HTTPException(status_code=403, detail="Requires super admin or org admin role.")


def _require_org_context(ctx: RequestContext) -> None:
    if not ctx.org_id:
        raise HTTPException(status_code=400, detail="No organization context. Switch to an org first.")


# ── List ───────────────────────────────────────────────────────────────────────

@router.get("")
async def list_rulesets(
    workflow_type: Optional[str] = Query(default=None),
    ctx: RequestContext = authorize("cost_seg:read"),
    session: AsyncSession = Depends(get_db),
) -> list[dict]:
    _require_admin(ctx)
    _require_org_context(ctx)
    q = (
        select(CostSegRuleset)
        .where(CostSegRuleset.org_id == ctx.org_id)
        .order_by(CostSegRuleset.created_at.desc())
    )
    if workflow_type:
        q = q.where(CostSegRuleset.workflow_type == workflow_type)
    result = await session.execute(q)
    return [_to_dict(r) for r in result.scalars().all()]


# ── Upload ─────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def upload_ruleset(
    file: UploadFile = File(...),
    workflow_type: str = Form(default="cost_seg"),
    ctx: RequestContext = authorize("cost_seg:read"),
) -> dict:
    _require_admin(ctx)
    _require_org_context(ctx)
    body = await file.read()
    if len(body) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Maximum 10 MB.")

    filename = file.filename or "ruleset.json"

    async with db_session(ctx.org_id) as sess:
        ruleset = CostSegRuleset(
            org_id=ctx.org_id,
            workflow_type=workflow_type,
            filename=filename,
            size_bytes=len(body),
            status="ready",
        )
        sess.add(ruleset)
        await sess.flush()
        s3_key = f"{ctx.org_id}/rulesets/{workflow_type}/{ruleset.id}"
        ruleset.s3_key = s3_key
        sess.add(ruleset)
        await sess.flush()
        data = _to_dict(ruleset)

    await s3_upload(s3_key, body)
    logger.info("Ruleset uploaded", ruleset_id=data["id"], workflow_type=workflow_type, filename=filename, org_id=str(ctx.org_id))
    return data


# ── Replace ────────────────────────────────────────────────────────────────────

@router.put("/{ruleset_id}", status_code=200)
async def replace_ruleset(
    ruleset_id: UUID,
    file: UploadFile = File(...),
    ctx: RequestContext = authorize("cost_seg:read"),
) -> dict:
    _require_admin(ctx)
    _require_org_context(ctx)
    body = await file.read()
    if len(body) > MAX_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Maximum 10 MB.")

    async with db_session(ctx.org_id) as sess:
        result = await sess.execute(
            select(CostSegRuleset).where(
                CostSegRuleset.id == ruleset_id,
                CostSegRuleset.org_id == ctx.org_id,
            )
        )
        ruleset = result.scalars().first()
        if not ruleset:
            raise HTTPException(status_code=404, detail="Ruleset not found.")

        ruleset.filename = file.filename or ruleset.filename
        ruleset.size_bytes = len(body)
        ruleset.status = "ready"
        ruleset.updated_at = datetime.now(timezone.utc)
        sess.add(ruleset)
        await sess.flush()
        data = _to_dict(ruleset)

    await s3_upload(ruleset.s3_key, body)
    logger.info("Ruleset replaced", ruleset_id=str(ruleset_id), org_id=str(ctx.org_id))
    return data


# ── Delete ─────────────────────────────────────────────────────────────────────

@router.delete("/{ruleset_id}", status_code=204)
async def delete_ruleset(
    ruleset_id: UUID,
    ctx: RequestContext = authorize("cost_seg:read"),
) -> None:
    _require_admin(ctx)
    _require_org_context(ctx)
    async with db_session(ctx.org_id) as sess:
        result = await sess.execute(
            select(CostSegRuleset).where(
                CostSegRuleset.id == ruleset_id,
                CostSegRuleset.org_id == ctx.org_id,
            )
        )
        ruleset = result.scalars().first()
        if not ruleset:
            raise HTTPException(status_code=404, detail="Ruleset not found.")
        s3_key = ruleset.s3_key
        await sess.execute(delete(CostSegRuleset).where(CostSegRuleset.id == ruleset_id))

    if s3_key:
        try:
            await s3_delete(s3_key)
        except Exception as exc:
            logger.warning("Failed to delete ruleset from S3", key=s3_key, error=str(exc))


# ── Download ───────────────────────────────────────────────────────────────────

@router.get("/{ruleset_id}/download")
async def download_ruleset(
    ruleset_id: UUID,
    ctx: RequestContext = authorize("cost_seg:read"),
    session: AsyncSession = Depends(get_db),
):
    _require_admin(ctx)
    _require_org_context(ctx)
    result = await session.execute(
        select(CostSegRuleset).where(
            CostSegRuleset.id == ruleset_id,
            CostSegRuleset.org_id == ctx.org_id,
        )
    )
    ruleset = result.scalars().first()
    if not ruleset or not ruleset.s3_key:
        raise HTTPException(status_code=404, detail="Ruleset not found.")

    if _is_local_mode():
        local_path = _local_path(ruleset.s3_key)
        if not local_path.exists():
            raise HTTPException(status_code=404, detail="Ruleset file not found on disk.")
        return FileResponse(
            path=str(local_path),
            filename=ruleset.filename,
            media_type="application/octet-stream",
        )
    url = await presigned_get(ruleset.s3_key, filename=ruleset.filename, content_type="application/octet-stream")
    return RedirectResponse(url)
