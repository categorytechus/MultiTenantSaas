"""
Due Diligence API — /api/due-diligence/*

Projects: study CRUD, deal details, document upload, analysis trigger,
          Stripe checkout, report generation + preview.
"""
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

import stripe
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import db_session, get_db
from app.core.logging import get_logger
from app.core.rbac import authorize
from app.core.tenancy import RequestContext
from app.integrations.s3 import make_s3_key, upload as s3_upload
from app.models.document import Document
from app.models.due_diligence import DueDiligenceStudy
from app.models.org import Org
from app.models.user import User
from app.services import due_diligence as svc
from app.services.audit import log_action

router = APIRouter(prefix="/api/due-diligence", tags=["due-diligence"])
logger = get_logger(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ── Response serializers ───────────────────────────────────────────────────────

def _study_out(s: DueDiligenceStudy) -> dict:
    return {
        "id": str(s.id),
        "title": s.title,
        "offering_category": s.offering_category,
        "offering_type": s.offering_type,
        "status": s.status,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _doc_out(d: Document) -> dict:
    return {
        "id": str(d.id),
        "study_id": str(d.session_id) if d.session_id else None,
        "filename": d.filename,
        "mime_type": d.mime_type,
        "size_bytes": d.size_bytes,
        "status": d.status,
        "created_at": d.created_at.isoformat(),
    }


# ── Offering types ─────────────────────────────────────────────────────────────

@router.get("/offering-types")
async def list_offering_types(
    ctx: RequestContext = authorize("due_diligence:read"),
) -> Any:
    return {"data": svc.OFFERING_TYPES}


# ── Studies ────────────────────────────────────────────────────────────────────

class CreateStudyRequest(BaseModel):
    title: str
    offering_category: str
    offering_type: str


@router.post("/studies", status_code=201)
async def create_study(
    body: CreateStudyRequest,
    ctx: RequestContext = authorize("due_diligence:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    # Validate offering type
    valid_types = svc.OFFERING_TYPES.get(body.offering_category, [])
    if body.offering_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid offering_type '{body.offering_type}' for category '{body.offering_category}'",
        )
    async with db_session(ctx.org_id) as sess:
        study = await svc.create_study(
            sess,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            title=body.title,
            offering_category=body.offering_category,
            offering_type=body.offering_type,
        )
        await log_action(sess, ctx, "due_diligence.study.create", "due_diligence_study", str(study.id))
    return {"data": _study_out(study)}


@router.get("/studies")
async def list_studies(
    ctx: RequestContext = authorize("due_diligence:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    studies = await svc.list_studies(session, ctx.org_id)
    return {"data": [_study_out(s) for s in studies]}


def _format_scorecard(raw_rules: list[dict]) -> dict:
    results = []
    overall_status = "PASS"
    
    for r in raw_rules:
        passed = r["passed"]
        if passed is True:
            eval_str = "PASS"
        elif passed is False:
            eval_str = "FAIL"
            overall_status = "FAIL"
        else:
            eval_str = "REVIEW"
            if overall_status != "FAIL":
                overall_status = "REVIEW"
                
        actual = r["actual_value"]
        if actual is None:
            reason = "Could not extract value"
        else:
            reason = f"Actual: {actual} {r['unit']}".strip()
            
        op_map = {
            "gt": ">",
            "lt": "<",
            "gte": "≥",
            "lte": "≤",
            "eq": "=",
        }
        human_op = op_map.get(r['operator'], r['operator'])
        desc = f"Requires {human_op} {r['threshold']} {r['unit']}".strip()
        
        results.append({
            "rule_id": r["rule_id"],
            "rule_name": r["rule_label"],
            "rule_key": r["rule_key"],
            "description": desc,
            "evaluation": eval_str,
            "reason": reason,
            "actual_value": actual,
        })
        
    summary = "All required criteria met for this offering."
    if overall_status == "FAIL":
        summary = "One or more required criteria failed."
    elif overall_status == "REVIEW":
        summary = "Some metrics could not be extracted; manual review required."
        
    return {
        "results": results,
        "overall": overall_status,
        "summary": summary,
    }


@router.get("/studies/{study_id}")
async def get_study(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    study = await svc.get_study(session, study_id)
    details = svc.get_details_from_meta(study)

    # Check pricing availability for checkout
    org = await session.get(Org, ctx.org_id)
    overrides = org.due_diligence_price_overrides or {} if org else {}
    mapping = _get_price_mapping()
    can_checkout = (study.offering_type in mapping) or (study.offering_type in overrides)

    scorecard = None
    extracted_metrics = {}
    if study.status in ("analysis_complete", "paid", "report_ready"):
        raw_rules = await svc.evaluate_rules(session, study)
        scorecard = _format_scorecard(raw_rules)
        extracted_metrics = (study.meta or {}).get("metrics", {})

    return {
        "data": _study_out(study),
        "details": details,
        "can_checkout": can_checkout,
        "scorecard": scorecard,
        "extracted_metrics": extracted_metrics,
    }


class UpdateStudyRequest(BaseModel):
    title: Optional[str] = None
    rule_values: Optional[dict[str, Any]] = None


@router.patch("/studies/{study_id}")
async def update_study(
    study_id: UUID,
    body: UpdateStudyRequest,
    ctx: RequestContext = authorize("due_diligence:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    async with db_session(ctx.org_id) as sess:
        study = await svc.get_study(sess, study_id)
        meta_patch = {}
        if body.rule_values is not None:
            # Merge with existing rule_values, avoiding in-place mutation of the original reference
            existing_rule_values = dict((study.meta or {}).get("rule_values", {}))
            existing_rule_values.update(body.rule_values)
            meta_patch["rule_values"] = existing_rule_values
            
        study = await svc.update_study(sess, study, title=body.title, meta_patch=meta_patch if meta_patch else None)
    return {"data": _study_out(study)}


@router.delete("/studies/{study_id}", status_code=204)
async def delete_study(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:delete"),
    session: AsyncSession = Depends(get_db),
) -> None:
    async with db_session(ctx.org_id) as sess:
        await svc.delete_study(sess, study_id)
        await log_action(sess, ctx, "due_diligence.study.delete", "due_diligence_study", str(study_id))


# ── Deal details ───────────────────────────────────────────────────────────────

class RealEstateDetailsRequest(BaseModel):
    property_name: Optional[str] = None
    address_street: Optional[str] = None
    address_city: Optional[str] = None
    address_state: Optional[str] = None
    address_zip: Optional[str] = None
    address_country: Optional[str] = None
    property_type: Optional[str] = None
    historical_property: Optional[bool] = None
    investor_type: Optional[str] = None
    tax_depreciation: Optional[float] = None
    investor_returns_irr: Optional[float] = None
    investor_returns_em: Optional[float] = None
    investor_returns_coc: Optional[float] = None
    investor_returns_pref: Optional[float] = None
    fund_manager_returns_irr: Optional[float] = None
    fund_manager_returns_em: Optional[float] = None
    fund_manager_returns_coc: Optional[float] = None
    fund_manager_returns_pref: Optional[float] = None
    deal_room_link: Optional[str] = None
    close_date: Optional[str] = None
    additional_details: Optional[str] = None


class StartupDetailsRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    company_name: Optional[str] = None
    website: Optional[str] = None
    company_address_street: Optional[str] = None
    company_address_city: Optional[str] = None
    company_address_state: Optional[str] = None
    company_address_zip: Optional[str] = None
    company_address_country: Optional[str] = None
    stage: Optional[str] = None
    team_size: Optional[int] = None
    arr_usd: Optional[float] = None
    monthly_burn_usd: Optional[float] = None
    runway_months: Optional[float] = None
    total_raised_usd: Optional[float] = None
    notes: Optional[str] = None
    business_model: Optional[str] = None
    industry: Optional[str] = None
    total_raise_target: Optional[float] = None
    target_valuation_pre: Optional[float] = None
    deal_room_link: Optional[str] = None
    vc_introductions: Optional[str] = None
    customer_introductions: Optional[str] = None
    deal_type: Optional[str] = None


@router.post("/studies/{study_id}/details")
async def upsert_details(
    study_id: UUID,
    body: dict,  # Accept generic dict — validated based on offering_type
    ctx: RequestContext = authorize("due_diligence:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    async with db_session(ctx.org_id) as sess:
        study = await svc.get_study(sess, study_id)
        details = await svc.upsert_details(sess, study, **body)
        # Advance status
        if study.status == "draft":
            await svc.update_study(sess, study, status="details_added")
        updated = await svc.get_study(sess, study_id)
    return {"data": details, "study_status": updated.status}


@router.get("/studies/{study_id}/details")
async def get_details(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    study = await svc.get_study(session, study_id)
    return {"data": svc.get_details_from_meta(study)}


# ── Documents ─────────────────────────────────────────────────────────────────

@router.post("/studies/{study_id}/documents", status_code=202)
async def upload_document(
    study_id: UUID,
    file: UploadFile = File(...),
    ctx: RequestContext = authorize("due_diligence:create"),
) -> Any:
    body = await file.read()
    if len(body) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Maximum 50 MB.",
        )

    filename = file.filename or "upload"
    mime_type = file.content_type
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "bin"

    async with db_session(ctx.org_id) as sess:
        await svc.get_study(sess, study_id)  # 404 guard
        doc = await svc.create_due_diligence_doc(
            sess,
            study_id=study_id,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            filename=filename,
            mime_type=mime_type,
            size_bytes=len(body),
        )
        doc_id = doc.id
        s3_key = make_s3_key(str(ctx.org_id), f"dd_{doc_id}", ext)
        doc.s3_key = s3_key
        sess.add(doc)

        # Advance status
        study = await svc.get_study(sess, study_id)
        if study.status in ("draft", "details_added"):
            await svc.update_study(sess, study, status="documents_uploaded")

    await s3_upload(s3_key, body, tags={"org_id": str(ctx.org_id), "due_diligence_doc": str(doc_id)})
    return {"data": {"id": str(doc_id), "filename": filename, "status": "ready"}}


@router.get("/studies/{study_id}/documents")
async def list_documents(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    docs = await svc.list_due_diligence_docs(session, study_id)
    return {"data": [_doc_out(d) for d in docs]}


@router.delete("/studies/{study_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    study_id: UUID,
    doc_id: UUID,
    ctx: RequestContext = authorize("due_diligence:create"),
    session: AsyncSession = Depends(get_db),
) -> None:
    async with db_session(ctx.org_id) as sess:
        await svc.delete_due_diligence_doc(sess, doc_id)


# ── Analysis ───────────────────────────────────────────────────────────────────

@router.post("/studies/{study_id}/analyze", status_code=202)
async def analyze_study(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    docs = await svc.list_due_diligence_docs(session, study_id)
    if not docs:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload at least one document before running analysis.",
        )

    # Create AgentTask and enqueue Arq job
    from app.models.agent_task import AgentTask
    from app.services.agent_tasks import create_task

    async with db_session(ctx.org_id) as sess:
        study = await svc.get_study(sess, study_id)
        task = await create_task(
            sess,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            task_type="due_diligence_report",
            input_data={
                "study_id": str(study_id),
                "doc_ids": [str(d.id) for d in docs],
            },
        )
        task_id = task.id
        await svc.update_study(sess, study, status="analyzing")
        await log_action(sess, ctx, "due_diligence.analyze.start", "due_diligence_study", str(study_id))

    # Enqueue Arq job
    try:
        from arq.connections import create_pool, RedisSettings
        redis_conn = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        await redis_conn.enqueue_job(
            "run_due_diligence",
            task_id=str(task_id),
            org_id=str(ctx.org_id),
            study_id=str(study_id),
        )
        await redis_conn.aclose()
    except Exception as e:
        logger.error("Failed to enqueue due diligence job", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to start analysis. Please try again.")

    return {"message": "Analysis started", "study_id": str(study_id), "task_id": str(task_id)}


# ── Scorecard ──────────────────────────────────────────────────────────────────

@router.get("/studies/{study_id}/scorecard")
async def get_scorecard(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    study = await svc.get_study(session, study_id)
    scorecard = await svc.evaluate_rules(session, study)
    return {"data": scorecard}


# ── Stripe Checkout ────────────────────────────────────────────────────────────

def _get_price_mapping() -> dict[str, str]:
    return getattr(settings, "STRIPE_DUE_DILIGENCE_PRICE_MAPPING", {}) or {}


@router.post("/studies/{study_id}/checkout-session")
async def create_checkout_session(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    stripe.api_key = settings.STRIPE_API_KEY

    async with db_session(ctx.org_id) as sess:
        study = await svc.get_study(sess, study_id)

        if study.status not in ("analysis_complete", "paid", "report_ready"):
            raise HTTPException(
                status_code=422,
                detail="Complete analysis before purchasing the report.",
            )

        public_app_url = getattr(settings, "PUBLIC_APP_URL", "http://localhost:3000")
        org = await sess.get(Org, ctx.org_id)
        overrides = (org.due_diligence_price_overrides or {}) if org else {}
        mapping = _get_price_mapping()

        if study.offering_type in overrides:
            price = overrides[study.offering_type]
            product_id = getattr(settings, "STRIPE_DUE_DILIGENCE_PRODUCT_ID", None)
            if not product_id:
                raise HTTPException(status_code=500, detail="Payment configuration error")
            line_item = {
                "price_data": {
                    "currency": "usd",
                    "product": product_id,
                    "unit_amount": int(price * 100),
                },
                "quantity": 1,
            }
        else:
            price_id = mapping.get(study.offering_type)
            if not price_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"No pricing configured for offering type '{study.offering_type}'",
                )
            line_item = {"price": price_id, "quantity": 1}

        checkout_session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[line_item],
            mode="payment",
            client_reference_id=str(study_id),
            metadata={"study_type": "due_diligence", "study_id": str(study_id)},
            success_url=(
                f"{public_app_url}/due_diligence/{study_id}"
                f"?session_id={{CHECKOUT_SESSION_ID}}&payment_success=1"
            ),
            cancel_url=f"{public_app_url}/due_diligence/{study_id}?payment_cancelled=1",
        )

    return {"checkout_url": checkout_session.url}


# ── Report ─────────────────────────────────────────────────────────────────────

@router.post("/studies/{study_id}/report")
async def generate_report(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    study = await svc.get_study(session, study_id)
    if study.status not in ("paid", "report_ready", "analysis_complete"):
        raise HTTPException(
            status_code=422,
            detail="Complete analysis and payment before generating the report.",
        )

    # We will enqueue the background job here as a fallback in case the webhook missed it.
    from sqlalchemy import select as sa_select
    from app.models.agent_task import AgentTask, AgentTaskType
    from app.services.agent_tasks import create_task
    from arq.connections import create_pool, RedisSettings

    # Check if a report task is already pending or running for this study
    existing_task = await session.execute(
        sa_select(AgentTask).where(
            AgentTask.org_id == ctx.org_id,
            AgentTask.type == AgentTaskType.DUE_DILIGENCE_REPORT.value,
            AgentTask.status.in_(["pending", "running"]),
            AgentTask.input["study_id"].as_string() == str(study_id)
        )
    )
    if existing_task.scalars().first():
        return {"status": "processing", "message": "Report generation is already in progress"}

    # Use the current user, or fallback to an org admin if unauthenticated
    target_user_id = ctx.user_id
    if not target_user_id:
        from app.models.org import OrgMembership
        membership_result = await session.execute(
            sa_select(OrgMembership.user_id).where(OrgMembership.org_id == ctx.org_id).limit(1)
        )
        target_user_id = membership_result.scalar()
        if not target_user_id:
            raise HTTPException(status_code=500, detail="No user found to assign task")

    task = await create_task(
        session,
        org_id=ctx.org_id,
        user_id=target_user_id,
        task_type=AgentTaskType.DUE_DILIGENCE_REPORT,
        input_data={"study_id": str(study_id)},
    )

    try:
        redis_conn = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        await redis_conn.enqueue_job(
            "run_due_diligence_report",
            _job_id=f"dd_report_{study_id}",
            task_id=str(task.id),
            org_id=str(ctx.org_id),
            study_id=str(study_id),
        )
        await redis_conn.aclose()
        await log_action(session, ctx, "due_diligence.report.enqueue", "due_diligence_study", str(study_id))
    except Exception as e:
        logger.error("Failed to enqueue report generation task", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to enqueue report generation")

    return {"status": "enqueued", "task_id": str(task.id)}


@router.get("/studies/{study_id}/report")
async def get_report(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    report = await svc.get_report(session, study_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not yet generated")
    return {"data": {"html": report["content"], "generated_at": report["generated_at"].isoformat()}}


@router.get("/studies/{study_id}/report/preview", response_class=HTMLResponse)
async def preview_report(
    study_id: UUID,
    ctx: RequestContext = authorize("due_diligence:read"),
    session: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    report = await svc.get_report(session, study_id)
    if not report:
        raise HTTPException(
            status_code=404,
            detail="Report not yet generated. Use POST /report to generate.",
        )
    return HTMLResponse(content=report["content"])
