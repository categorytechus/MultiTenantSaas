from datetime import date
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import db_session, get_db
from app.core.logging import get_logger
from app.core.rbac import authorize
from app.core.tenancy import RequestContext
from app.integrations.s3 import make_s3_key, upload as s3_upload
from app.models.document import Document
from app.models.workflow import WorkflowItem, WorkflowSession
from app.services import cost_seg as svc
from app.services.audit import log_action

router = APIRouter(prefix="/api/cost-seg", tags=["cost-segregation"])
logger = get_logger(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


# ── Response serializers ───────────────────────────────────────────────────────

def _project_out(p: WorkflowSession) -> dict:
    meta = p.meta or {}
    return {
        "id": str(p.id),
        "name": p.title,
        "study_date": meta.get("study_date"),
        "status": p.status,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _doc_out(d: Document) -> dict:
    return {
        "id": str(d.id),
        "session_id": str(d.session_id) if d.session_id else None,
        "filename": d.filename,
        "mime_type": d.mime_type,
        "size_bytes": d.size_bytes,
        "status": d.status,
        "created_at": d.created_at.isoformat(),
    }


def _item_out(i: WorkflowItem) -> dict:
    d = i.data or {}
    return {
        "id": str(i.id),
        "session_id": str(i.session_id),
        "role": i.role,
        "description": i.content,
        "amount": i.amount,
        "category_id": d.get("category_id"),
        "category_label": d.get("category_label"),
        "recovery_period": d.get("recovery_period"),
        "bonus_eligible": d.get("bonus_eligible", False),
        "year1_deduction": d.get("year1_deduction"),
        "confidence": d.get("confidence"),
        "ai_notes": d.get("ai_notes"),
        "user_edited": d.get("user_edited", False),
        "source_doc_id": d.get("source_doc_id"),
        "created_at": i.created_at.isoformat(),
    }


# ── Projects ───────────────────────────────────────────────────────────────────

class CreateProjectRequest(BaseModel):
    name: str
    study_date: Optional[date] = None


@router.post("/projects", status_code=201)
async def create_project(
    body: CreateProjectRequest,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    async with db_session(ctx.org_id) as sess:
        project = await svc.create_project(
            sess,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            name=body.name,
            study_date=body.study_date,
        )
        await log_action(sess, ctx, "cost_seg.project.create", "workflow_session", str(project.id))
    return {"data": _project_out(project)}


@router.get("/projects")
async def list_projects(
    ctx: RequestContext = authorize("cost_seg:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    projects = await svc.list_projects(session, ctx.org_id)
    return {"data": [_project_out(p) for p in projects]}


@router.get("/projects/{project_id}")
async def get_project(
    project_id: UUID,
    ctx: RequestContext = authorize("cost_seg:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    project = await svc.get_project(session, project_id)
    prop = svc.get_property_from_meta(project)
    return {"data": _project_out(project), "property": prop}


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    study_date: Optional[date] = None


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: UUID,
    body: UpdateProjectRequest,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    async with db_session(ctx.org_id) as sess:
        project = await svc.get_project(sess, project_id)
        project = await svc.update_project(
            sess, project, name=body.name, study_date=body.study_date
        )
    return {"data": _project_out(project)}


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID,
    ctx: RequestContext = authorize("cost_seg:delete"),
    session: AsyncSession = Depends(get_db),
) -> None:
    async with db_session(ctx.org_id) as sess:
        await svc.delete_project(sess, project_id)
        await log_action(sess, ctx, "cost_seg.project.delete", "workflow_session", str(project_id))


# ── Property ───────────────────────────────────────────────────────────────────

class PropertyRequest(BaseModel):
    property_name: str
    address: str
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    property_type: str = "commercial"
    acquisition_date: Optional[date] = None
    total_cost: float = 0.0
    land_value: Optional[float] = None
    building_value: Optional[float] = None
    improvement_cost: Optional[float] = None
    notes: Optional[str] = None


@router.post("/projects/{project_id}/property")
async def upsert_property(
    project_id: UUID,
    body: PropertyRequest,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    fields = body.model_dump()
    if fields.get("acquisition_date"):
        fields["acquisition_date"] = fields["acquisition_date"].isoformat()

    async with db_session(ctx.org_id) as sess:
        project = await svc.get_project(sess, project_id)
        await svc.upsert_property(sess, project_id=project_id, org_id=ctx.org_id, **fields)
        if project.status == "draft":
            await svc.update_project(sess, project, status="property_added")
        updated = await svc.get_project(sess, project_id)

    return {"data": fields, "project_status": updated.status}


@router.get("/projects/{project_id}/property")
async def get_property(
    project_id: UUID,
    ctx: RequestContext = authorize("cost_seg:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    project = await svc.get_project(session, project_id)
    return {"data": svc.get_property_from_meta(project)}


# ── Documents ──────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/documents", status_code=202)
async def upload_document(
    project_id: UUID,
    file: UploadFile = File(...),
    ctx: RequestContext = authorize("cost_seg:create"),
) -> Any:
    body = await file.read()
    if len(body) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Maximum 50MB.",
        )

    filename = file.filename or "upload"
    mime_type = file.content_type
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "bin"

    async with db_session(ctx.org_id) as sess:
        await svc.get_project(sess, project_id)  # 404 guard
        doc = await svc.create_cost_seg_doc(
            sess,
            project_id=project_id,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            filename=filename,
            mime_type=mime_type,
            size_bytes=len(body),
        )
        doc_id = doc.id
        s3_key = make_s3_key(str(ctx.org_id), f"costseg_{doc_id}", ext)
        doc.s3_key = s3_key
        sess.add(doc)

        # Advance project status if still early
        project = await svc.get_project(sess, project_id)
        if project.status in ("draft", "property_added"):
            await svc.update_project(sess, project, status="documents_uploaded")

    await s3_upload(s3_key, body, tags={"org_id": str(ctx.org_id), "cost_seg_doc": str(doc_id)})

    return {"data": {"id": str(doc_id), "filename": filename, "status": "ready"}}


@router.get("/projects/{project_id}/documents")
async def list_documents(
    project_id: UUID,
    ctx: RequestContext = authorize("cost_seg:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    docs = await svc.list_cost_seg_docs(session, project_id)
    return {"data": [_doc_out(d) for d in docs]}


@router.delete("/projects/{project_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    project_id: UUID,
    doc_id: UUID,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> None:
    async with db_session(ctx.org_id) as sess:
        await svc.delete_cost_seg_doc(sess, doc_id)


# ── Analysis ───────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/analyze", status_code=202)
async def analyze_project(
    project_id: UUID,
    background_tasks: BackgroundTasks,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    docs = await svc.list_cost_seg_docs(session, project_id)
    if not docs:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload at least one document before running analysis.",
        )
    background_tasks.add_task(
        svc.classify_documents_bg,
        project_id,
        ctx.org_id,
        [d.id for d in docs],
    )
    return {"message": "Analysis started", "project_id": str(project_id)}


# ── Line items ─────────────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/line-items")
async def list_line_items(
    project_id: UUID,
    ctx: RequestContext = authorize("cost_seg:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    items = await svc.list_line_items(session, project_id)
    return {"data": [_item_out(i) for i in items]}


class AddLineItemRequest(BaseModel):
    description: str
    amount: float
    category_id: str
    ai_notes: Optional[str] = None


@router.post("/projects/{project_id}/line-items", status_code=201)
async def add_line_item(
    project_id: UUID,
    body: AddLineItemRequest,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    async with db_session(ctx.org_id) as sess:
        await svc.get_project(sess, project_id)
        item = await svc.add_line_item(
            sess,
            project_id=project_id,
            org_id=ctx.org_id,
            description=body.description,
            amount=body.amount,
            category_id=body.category_id,
            ai_notes=body.ai_notes,
            user_edited=True,
        )
    return {"data": _item_out(item)}


class UpdateLineItemRequest(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = None
    category_id: Optional[str] = None
    ai_notes: Optional[str] = None


@router.patch("/projects/{project_id}/line-items/{item_id}")
async def update_line_item(
    project_id: UUID,
    item_id: UUID,
    body: UpdateLineItemRequest,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    async with db_session(ctx.org_id) as sess:
        item = await svc.update_line_item(
            sess, item_id,
            description=body.description,
            amount=body.amount,
            category_id=body.category_id,
            ai_notes=body.ai_notes,
        )
    return {"data": _item_out(item)}


@router.delete("/projects/{project_id}/line-items/{item_id}", status_code=204)
async def delete_line_item(
    project_id: UUID,
    item_id: UUID,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> None:
    async with db_session(ctx.org_id) as sess:
        await svc.delete_line_item(sess, item_id)


# ── Categories reference ───────────────────────────────────────────────────────

@router.get("/categories")
async def list_categories(
    ctx: RequestContext = authorize("cost_seg:read"),
) -> Any:
    return {
        "data": [
            {
                "id": cat_id,
                "label": cat["label"],
                "recovery_period": cat.get("recovery_period"),
                "bonus_eligible": cat.get("bonus_eligible", False),
                "depreciable": cat.get("depreciable"),
            }
            for cat_id, cat in svc.CATEGORIES.items()
        ]
    }


# ── Payment bypass ─────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/payment")
async def process_payment(
    project_id: UUID,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    async with db_session(ctx.org_id) as sess:
        project = await svc.get_project(sess, project_id)
        await svc.update_project(sess, project, status="paid")
        await log_action(sess, ctx, "cost_seg.payment", "workflow_session", str(project_id))
    return {"message": "Payment processed (test mode)", "status": "paid"}


# ── Report ─────────────────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/report")
async def generate_report(
    project_id: UUID,
    ctx: RequestContext = authorize("cost_seg:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    project = await svc.get_project(session, project_id)
    if project.status not in ("paid", "report_ready", "analysis_complete"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Complete analysis before generating a report.",
        )
    async with db_session(ctx.org_id) as sess:
        html = await svc.generate_report(sess, project_id, ctx.org_id)
        project = await svc.get_project(sess, project_id)
        if project.status != "report_ready":
            await svc.update_project(sess, project, status="report_ready")
        await log_action(sess, ctx, "cost_seg.report.generate", "workflow_session", str(project_id))
    return {"html": html}


@router.get("/projects/{project_id}/report")
async def get_report(
    project_id: UUID,
    ctx: RequestContext = authorize("cost_seg:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    report = await svc.get_report(session, project_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not yet generated")
    return {"data": {"html": report.content, "generated_at": report.generated_at.isoformat()}}
