"""
Due Diligence Rules API — /api/due-diligence-rules/*

Admin-only CRUD for per-org, per-offering-type pass/fail rules.
Accessible by org_admin and super_admin only.
"""
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import db_session, get_db
from app.core.logging import get_logger
from app.core.rbac import authorize
from app.core.tenancy import RequestContext
from app.models.due_diligence import DueDiligenceRule
from app.services import due_diligence as svc

router = APIRouter(prefix="/api/due-diligence-rules", tags=["due-diligence-rules"])
logger = get_logger(__name__)

VALID_OPERATORS = {"lt", "gt", "lte", "gte", "eq"}


def _require_admin(ctx: RequestContext) -> None:
    if ctx.role not in ("super_admin", "org_admin"):
        raise HTTPException(status_code=403, detail="Requires super admin or org admin role.")


def _require_org_context(ctx: RequestContext) -> None:
    if not ctx.org_id:
        raise HTTPException(status_code=400, detail="No organization context. Switch to an org first.")


def _rule_out(r: DueDiligenceRule) -> dict:
    return {
        "id": str(r.id),
        "org_id": str(r.org_id),
        "offering_category": r.offering_category,
        "offering_type": r.offering_type,
        "rule_key": r.rule_key,
        "rule_label": r.rule_label,
        "operator": r.operator,
        "threshold": r.threshold,
        "unit": r.unit or "",
        "enabled": r.enabled,
        "created_at": r.created_at.isoformat(),
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


# ── List ───────────────────────────────────────────────────────────────────────

@router.get("")
async def list_rules(
    offering_type: Optional[str] = None,
    ctx: RequestContext = authorize("due_diligence:read"),
    session: AsyncSession = Depends(get_db),
) -> list[dict]:
    _require_admin(ctx)
    _require_org_context(ctx)
    rules = await svc.list_rules(session, ctx.org_id, offering_type=offering_type)
    return [_rule_out(r) for r in rules]


# ── Create ─────────────────────────────────────────────────────────────────────

class CreateRuleRequest(BaseModel):
    offering_category: str
    offering_type: str
    rule_key: str
    rule_label: str
    operator: str
    threshold: float
    unit: Optional[str] = None
    enabled: bool = True


@router.post("", status_code=201)
async def create_rule(
    body: CreateRuleRequest,
    ctx: RequestContext = authorize("due_diligence:create"),
) -> dict:
    _require_admin(ctx)
    _require_org_context(ctx)

    if body.operator not in VALID_OPERATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid operator '{body.operator}'. Must be one of: {sorted(VALID_OPERATORS)}",
        )

    async with db_session(ctx.org_id) as sess:
        rule = await svc.create_rule(
            sess,
            org_id=ctx.org_id,
            offering_category=body.offering_category,
            offering_type=body.offering_type,
            rule_key=body.rule_key,
            rule_label=body.rule_label,
            operator=body.operator,
            threshold=body.threshold,
            unit=body.unit,
            enabled=body.enabled,
        )
    logger.info("DD rule created", rule_id=str(rule.id), org_id=str(ctx.org_id))
    return _rule_out(rule)


# ── Update ─────────────────────────────────────────────────────────────────────

class UpdateRuleRequest(BaseModel):
    rule_label: Optional[str] = None
    operator: Optional[str] = None
    threshold: Optional[float] = None
    unit: Optional[str] = None
    enabled: Optional[bool] = None


@router.put("/{rule_id}", status_code=200)
async def update_rule(
    rule_id: UUID,
    body: UpdateRuleRequest,
    ctx: RequestContext = authorize("due_diligence:create"),
    session: AsyncSession = Depends(get_db),
) -> dict:
    _require_admin(ctx)
    _require_org_context(ctx)

    if body.operator is not None and body.operator not in VALID_OPERATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid operator '{body.operator}'. Must be one of: {sorted(VALID_OPERATORS)}",
        )

    async with db_session(ctx.org_id) as sess:
        rule = await svc.get_rule(sess, rule_id, ctx.org_id)
        rule = await svc.update_rule(
            sess,
            rule,
            rule_label=body.rule_label,
            operator=body.operator,
            threshold=body.threshold,
            unit=body.unit,
            enabled=body.enabled,
        )
    return _rule_out(rule)


# ── Delete ─────────────────────────────────────────────────────────────────────

@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: UUID,
    ctx: RequestContext = authorize("due_diligence:create"),
    session: AsyncSession = Depends(get_db),
) -> None:
    _require_admin(ctx)
    _require_org_context(ctx)
    async with db_session(ctx.org_id) as sess:
        await svc.get_rule(sess, rule_id, ctx.org_id)  # 404 guard
        await svc.delete_rule(sess, rule_id)


# ── Seed defaults ──────────────────────────────────────────────────────────────

@router.post("/seed-defaults", status_code=201)
async def seed_default_rules(
    ctx: RequestContext = authorize("due_diligence:create"),
) -> Any:
    _require_admin(ctx)
    _require_org_context(ctx)

    async with db_session(ctx.org_id) as sess:
        created = await svc.seed_default_rules(sess, ctx.org_id)

    logger.info("DD default rules seeded", count=len(created), org_id=str(ctx.org_id))
    return {
        "created": len(created),
        "message": f"Seeded {len(created)} default rules (skipped existing).",
    }
