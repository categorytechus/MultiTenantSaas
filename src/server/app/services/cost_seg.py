"""
Cost segregation service — built on the generic workflow tables.

WorkflowSession  (type='cost_seg') → project
WorkflowItem     (type='line_item') → extracted / manually-entered assets
WorkflowOutput   (type='html_report') → generated HTML report
Document         (session_id=project.id) → uploaded invoice / receipt / image
"""
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.db import db_session
from app.core.logging import get_logger
from app.integrations.llm import llm
from app.integrations.s3 import download as s3_download
from app.models.document import Document, DocumentStatus
from app.models.workflow import WorkflowItem, WorkflowOutput, WorkflowSession
from app.services.ingestion import parse_document

logger = get_logger(__name__)

WORKFLOW_TYPE = "cost_seg"
ITEM_TYPE = "line_item"
OUTPUT_TYPE = "html_report"

# ── IRS MACRS taxonomy ─────────────────────────────────────────────────────────

CATEGORIES: dict[str, dict] = {
    "land": {
        "label": "Land",
        "recovery_period": None,
        "depreciable": False,
        "bonus_eligible": False,
    },
    "personal_property_5yr": {
        "label": "Personal Property – 5-year",
        "recovery_period": 5,
        "depreciable": True,
        "bonus_eligible": True,
    },
    "personal_property_7yr": {
        "label": "Personal Property – 7-year",
        "recovery_period": 7,
        "depreciable": True,
        "bonus_eligible": True,
    },
    "land_improvements_15yr": {
        "label": "Land Improvements – 15-year",
        "recovery_period": 15,
        "depreciable": True,
        "bonus_eligible": True,
    },
    "qualified_improvement_property_15yr": {
        "label": "Qualified Improvement Property (QIP) – 15-year",
        "recovery_period": 15,
        "depreciable": True,
        "bonus_eligible": True,
    },
    "building_39yr": {
        "label": "Building – Section 1250 (39-year)",
        "recovery_period": 39,
        "depreciable": True,
        "bonus_eligible": False,
    },
    "needs_review": {
        "label": "Needs Review",
        "recovery_period": None,
        "depreciable": None,
        "bonus_eligible": False,
    },
    "excluded": {
        "label": "Excluded – Not Depreciable",
        "recovery_period": None,
        "depreciable": False,
        "bonus_eligible": False,
    },
}

# MACRS Year-1 rates (standard, no bonus, half-year convention)
_MACRS_Y1: dict[int, float] = {5: 0.2000, 7: 0.1429, 15: 0.0500, 39: 0.0256}
_QIP_Y1 = 0.0333   # QIP 15-yr SL half-year
BONUS_PCT = 0.20    # 2026 bonus depreciation phase-down

_TAXONOMY_PROMPT = """
IRS MACRS CLASSIFICATION (GDS) — valid category_id values:

land                              — Land, closing costs, demolition, remediation. NOT depreciable.
personal_property_5yr             — 5-yr MACRS. Carpet (tacked), window treatments, appliances, decorative fixtures, cabinets/countertops (non-structural), security/camera systems, tenant IT cabling, AV systems, interior signage, specialty plumbing/electrical serving specific equipment only, walk-in coolers, commercial kitchen equipment, tenant-specific or process-specific HVAC.
personal_property_7yr             — 7-yr MACRS. Office furniture, freestanding shelving/racks, reception counters, gym equipment, retail display fixtures, catch-all personal property.
land_improvements_15yr            — 15-yr MACRS. Parking lot/asphalt/paving, sidewalks, exterior site lighting, fencing & gates, retaining walls (not attached to building), storm drainage, irrigation, exterior monument signs, detached site amenities.
qualified_improvement_property_15yr — 15-yr QIP. Interior improvements to non-residential building placed in service AFTER the building's original placed-in-service date. Excludes enlargements, elevators/escalators, internal structural framework.
building_39yr                     — 39-yr Section 1250. Structural frame/foundation, exterior walls/facade, roof, general HVAC (multi-tenant/building-wide), general electrical distribution, general plumbing, elevators/escalators, fire suppression (building-wide), load-bearing partitions, exterior windows/doors/storefront, stairs, general lighting, loading dock structures.
needs_review                      — Use when description is vague, spans categories, confidence < 0.70, or large ambiguous amount (>$25,000).
excluded                          — Vegetation (trees/shrubs/sod), financing fees, due diligence, transfer taxes, inventory.

KEY TESTS:
• HVAC: multi-tenant/building → 39yr; single tenant/process → 5yr
• Electrical: distribution panels/conduit → 39yr; dedicated equipment circuits → 5yr
• Plumbing: restrooms/common → 39yr; specific equipment (coffee bar, lab, kitchen) → 5yr
• Removability (supporting factor only): can remove without structural damage → lean personal property
"""


# ── Project CRUD ───────────────────────────────────────────────────────────────

async def create_project(
    session: AsyncSession,
    *,
    org_id: UUID,
    user_id: UUID,
    name: str,
    study_date=None,
) -> WorkflowSession:
    project = WorkflowSession(
        org_id=org_id,
        user_id=user_id,
        type=WORKFLOW_TYPE,
        title=name,
        status="draft",
        meta={"study_date": study_date.isoformat() if study_date else None, "property": None},
    )
    session.add(project)
    await session.flush()
    return project


async def list_projects(session: AsyncSession, org_id: UUID) -> list[WorkflowSession]:
    result = await session.execute(
        select(WorkflowSession)
        .where(WorkflowSession.org_id == org_id, WorkflowSession.type == WORKFLOW_TYPE)
        .order_by(WorkflowSession.created_at.desc())
    )
    return list(result.scalars().all())


async def get_project(session: AsyncSession, project_id: UUID) -> WorkflowSession:
    result = await session.execute(
        select(WorkflowSession).where(
            WorkflowSession.id == project_id,
            WorkflowSession.type == WORKFLOW_TYPE,
        )
    )
    project = result.scalars().first()
    if not project:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Cost segregation project not found")
    return project


async def update_project(
    session: AsyncSession,
    project: WorkflowSession,
    *,
    name: Optional[str] = None,
    study_date=None,
    status: Optional[str] = None,
    meta_patch: Optional[dict] = None,
) -> WorkflowSession:
    if name is not None:
        project.title = name
    if status is not None:
        project.status = status
    if study_date is not None or meta_patch:
        current_meta = dict(project.meta or {})
        if study_date is not None:
            current_meta["study_date"] = study_date.isoformat() if study_date else None
        if meta_patch:
            current_meta.update(meta_patch)
        project.meta = current_meta
    project.updated_at = datetime.now(timezone.utc)
    session.add(project)
    await session.flush()
    return project


async def delete_project(session: AsyncSession, project_id: UUID) -> None:
    for stmt in [
        sa_text("DELETE FROM workflow_outputs WHERE session_id = CAST(:id AS uuid)"),
        sa_text("DELETE FROM workflow_items WHERE session_id = CAST(:id AS uuid)"),
        sa_text("UPDATE documents SET session_id = NULL WHERE session_id = CAST(:id AS uuid)"),
        sa_text("DELETE FROM workflow_sessions WHERE id = CAST(:id AS uuid)"),
    ]:
        await session.execute(stmt, {"id": str(project_id)})


# ── Property (stored in WorkflowSession.meta['property']) ─────────────────────

async def upsert_property(
    session: AsyncSession,
    *,
    project_id: UUID,
    org_id: UUID,
    **fields,
) -> dict:
    project = await get_project(session, project_id)
    current_meta = dict(project.meta or {})
    current_meta["property"] = fields
    project.meta = current_meta
    project.updated_at = datetime.now(timezone.utc)
    session.add(project)
    await session.flush()
    return fields


def get_property_from_meta(project: WorkflowSession) -> Optional[dict]:
    return (project.meta or {}).get("property")


# ── Documents (existing documents table, session_id tagged) ───────────────────

async def create_cost_seg_doc(
    session: AsyncSession,
    *,
    project_id: UUID,
    org_id: UUID,
    user_id: UUID,
    filename: str,
    s3_key: Optional[str] = None,
    mime_type: Optional[str] = None,
    size_bytes: Optional[int] = None,
) -> Document:
    doc = Document(
        org_id=org_id,
        uploaded_by=user_id,
        filename=filename,
        document_type="file",
        s3_key=s3_key,
        mime_type=mime_type,
        size_bytes=size_bytes,
        status=DocumentStatus.READY.value,
        session_id=project_id,
    )
    session.add(doc)
    await session.flush()
    return doc


async def list_cost_seg_docs(
    session: AsyncSession, project_id: UUID
) -> list[Document]:
    result = await session.execute(
        select(Document)
        .where(Document.session_id == project_id)
        .order_by(Document.created_at)
    )
    return list(result.scalars().all())


async def delete_cost_seg_doc(session: AsyncSession, doc_id: UUID) -> Document:
    result = await session.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalars().first()
    if not doc:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Document not found")
    # Detach any line items that referenced this doc
    await session.execute(
        sa_text(
            "UPDATE workflow_items SET data = data - 'source_doc_id' "
            "WHERE data->>'source_doc_id' = :did"
        ),
        {"did": str(doc_id)},
    )
    await session.delete(doc)
    await session.flush()
    return doc


# ── Line items (WorkflowItem type='line_item') ─────────────────────────────────

async def list_line_items(
    session: AsyncSession, project_id: UUID
) -> list[WorkflowItem]:
    result = await session.execute(
        select(WorkflowItem)
        .where(
            WorkflowItem.session_id == project_id,
            WorkflowItem.type == ITEM_TYPE,
        )
        .order_by(WorkflowItem.created_at)
    )
    return list(result.scalars().all())


def _make_item_data(
    category_id: str,
    amount: float,
    *,
    confidence: Optional[float] = None,
    ai_notes: Optional[str] = None,
    user_edited: bool = False,
    source_doc_id: Optional[UUID] = None,
) -> dict:
    cat = CATEGORIES.get(category_id, CATEGORIES["needs_review"])
    year1 = _calc_year1(amount, category_id, cat)
    d: dict[str, Any] = {
        "category_id": category_id,
        "category_label": cat["label"],
        "recovery_period": cat.get("recovery_period"),
        "bonus_eligible": cat.get("bonus_eligible", False),
        "year1_deduction": year1,
        "confidence": confidence,
        "ai_notes": ai_notes or "",
        "user_edited": user_edited,
    }
    if source_doc_id:
        d["source_doc_id"] = str(source_doc_id)
    return d


async def add_line_item(
    session: AsyncSession,
    *,
    project_id: UUID,
    org_id: UUID,
    description: str,
    amount: float,
    category_id: str,
    source_doc_id: Optional[UUID] = None,
    ai_notes: Optional[str] = None,
    confidence: Optional[float] = None,
    user_edited: bool = False,
) -> WorkflowItem:
    item = WorkflowItem(
        session_id=project_id,
        org_id=org_id,
        type=ITEM_TYPE,
        role="manual" if user_edited else "ai",
        content=description,
        amount=amount,
        data=_make_item_data(
            category_id, amount,
            confidence=confidence,
            ai_notes=ai_notes,
            user_edited=user_edited,
            source_doc_id=source_doc_id,
        ),
    )
    session.add(item)
    await session.flush()
    return item


async def update_line_item(
    session: AsyncSession,
    item_id: UUID,
    *,
    description: Optional[str] = None,
    amount: Optional[float] = None,
    category_id: Optional[str] = None,
    ai_notes: Optional[str] = None,
) -> WorkflowItem:
    result = await session.execute(
        select(WorkflowItem).where(WorkflowItem.id == item_id)
    )
    item = result.scalars().first()
    if not item:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Line item not found")

    current_data = dict(item.data or {})

    if description is not None:
        item.content = description
    if amount is not None:
        item.amount = amount
    if category_id is not None:
        cat = CATEGORIES.get(category_id, CATEGORIES["needs_review"])
        current_data.update({
            "category_id": category_id,
            "category_label": cat["label"],
            "recovery_period": cat.get("recovery_period"),
            "bonus_eligible": cat.get("bonus_eligible", False),
        })
    if ai_notes is not None:
        current_data["ai_notes"] = ai_notes

    # Recalculate year1 whenever amount or category changes
    effective_amount = item.amount or 0
    effective_cat_id = current_data.get("category_id", "needs_review")
    current_data["year1_deduction"] = _calc_year1(
        effective_amount, effective_cat_id, CATEGORIES.get(effective_cat_id, {})
    )
    current_data["user_edited"] = True
    item.data = current_data
    item.role = "manual"

    session.add(item)
    await session.flush()
    return item


async def delete_line_item(session: AsyncSession, item_id: UUID) -> None:
    await session.execute(
        sa_text("DELETE FROM workflow_items WHERE id = CAST(:id AS uuid)"),
        {"id": str(item_id)},
    )


# ── Depreciation math ──────────────────────────────────────────────────────────

def _calc_year1(amount: float, category_id: str, cat: dict) -> Optional[float]:
    if not cat.get("depreciable"):
        return None
    rp = cat.get("recovery_period")
    if rp is None:
        return None
    standard_rate = (
        _QIP_Y1
        if category_id == "qualified_improvement_property_15yr"
        else _MACRS_Y1.get(rp, 0.0)
    )
    if cat.get("bonus_eligible"):
        return round(amount * BONUS_PCT + amount * (1 - BONUS_PCT) * standard_rate, 2)
    return round(amount * standard_rate, 2)


# ── AI Classification ──────────────────────────────────────────────────────────

async def classify_documents_bg(
    project_id: UUID,
    org_id: UUID,
    doc_ids: list[UUID],
) -> None:
    """Background task: extract text → LLM classify → store WorkflowItems."""

    async def _set_status(status: str) -> None:
        try:
            async with db_session(org_id) as sess:
                await sess.execute(
                    sa_text(
                        "UPDATE workflow_sessions SET status = :s, updated_at = :ts "
                        "WHERE id = CAST(:id AS uuid)"
                    ),
                    {"s": status, "id": str(project_id), "ts": datetime.now(timezone.utc)},
                )
        except Exception as e:
            logger.error("set_status failed", project_id=str(project_id), error=str(e))

    try:
        await _set_status("analyzing")
        text_parts: list[str] = []

        async with db_session(org_id) as sess:
            result = await sess.execute(
                select(Document).where(Document.id.in_(doc_ids))
            )
            docs = list(result.scalars().all())

        for doc in docs:
            try:
                if doc.s3_key:
                    body = await s3_download(doc.s3_key)
                    import asyncio
                    text = await asyncio.to_thread(parse_document, body, doc.mime_type)
                else:
                    text = f"[Document: {doc.filename} — no content extracted]"
                if text.strip():
                    text_parts.append(f"--- {doc.filename} ---\n{text[:8000]}")
            except Exception as e:
                logger.error("text extraction failed", doc_id=str(doc.id), error=str(e))

        if not text_parts:
            await _set_status("analysis_complete")
            return

        line_items = await _classify_with_llm("\n\n".join(text_parts))

        async with db_session(org_id) as sess:
            # Drop previous AI items; keep user-edited ones
            await sess.execute(
                sa_text(
                    "DELETE FROM workflow_items "
                    "WHERE session_id = CAST(:pid AS uuid) "
                    "AND type = 'line_item' "
                    "AND (data->>'user_edited')::boolean IS NOT TRUE"
                ),
                {"pid": str(project_id)},
            )
            for raw in line_items:
                cat_id = raw.get("category_id", "needs_review")
                if cat_id not in CATEGORIES:
                    cat_id = "needs_review"
                amount = float(raw.get("amount") or 0)
                src_id = raw.get("source_doc_id")
                item = WorkflowItem(
                    session_id=project_id,
                    org_id=org_id,
                    type=ITEM_TYPE,
                    role="ai",
                    content=str(raw.get("description", "Unknown item")),
                    amount=amount,
                    data=_make_item_data(
                        cat_id, amount,
                        confidence=float(raw.get("confidence") or 0.8),
                        ai_notes=str(raw.get("notes") or ""),
                        source_doc_id=UUID(src_id) if src_id else None,
                    ),
                )
                sess.add(item)

        await _set_status("analysis_complete")
        logger.info("classification done", project_id=str(project_id), items=len(line_items))

    except Exception as e:
        logger.error("classification failed", project_id=str(project_id), error=str(e))
        await _set_status("analysis_complete")


async def _classify_with_llm(text: str) -> list[dict]:
    system_prompt = (
        "You are a certified cost segregation specialist. "
        "Extract every line item that has a dollar amount from the provided construction/renovation/cost documents. "
        "Classify each using the IRS MACRS system below.\n\n"
        + _TAXONOMY_PROMPT
        + "\n\nRESPOND with a JSON array only — no markdown, no prose. "
        "Each element: {description, amount (number), category_id, confidence (0–1), notes (brief rationale)}. "
        "Omit items with zero or missing amounts."
    )
    try:
        raw = await llm.complete([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Classify all line items:\n\n{text[:12000]}"},
        ])
        raw = raw.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            parsed = parsed.get("line_items") or parsed.get("items") or []
        return [i for i in parsed if isinstance(i, dict) and i.get("amount")]
    except Exception as e:
        logger.warning("LLM classification error", error=str(e))
        return []


# ── Report generation ──────────────────────────────────────────────────────────

async def generate_report(
    session: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> str:
    project = await get_project(session, project_id)
    prop = get_property_from_meta(project)
    items = await list_line_items(session, project_id)

    html = _build_report_html(project, prop, items)
    totals = _build_totals(items)

    # Upsert via unique constraint (session_id, type)
    existing = await session.execute(
        select(WorkflowOutput).where(
            WorkflowOutput.session_id == project_id,
            WorkflowOutput.type == OUTPUT_TYPE,
        )
    )
    output = existing.scalars().first()
    if output:
        output.content = html
        output.data = totals
        output.generated_at = datetime.now(timezone.utc)
    else:
        output = WorkflowOutput(
            session_id=project_id,
            org_id=org_id,
            type=OUTPUT_TYPE,
            content=html,
            data=totals,
        )
    session.add(output)
    await session.flush()
    return html


async def get_report(session: AsyncSession, project_id: UUID) -> Optional[WorkflowOutput]:
    result = await session.execute(
        select(WorkflowOutput).where(
            WorkflowOutput.session_id == project_id,
            WorkflowOutput.type == OUTPUT_TYPE,
        )
    )
    return result.scalars().first()


def _build_totals(items: list[WorkflowItem]) -> dict:
    from collections import defaultdict
    by_cat: dict = defaultdict(lambda: {"label": "", "amount": 0.0, "year1": 0.0, "count": 0})
    for item in items:
        d = item.data or {}
        cat_id = d.get("category_id", "needs_review")
        by_cat[cat_id]["label"] = d.get("category_label", cat_id)
        by_cat[cat_id]["amount"] += item.amount or 0
        by_cat[cat_id]["year1"] += d.get("year1_deduction") or 0
        by_cat[cat_id]["count"] += 1
    return {
        "total_cost": sum(i.amount or 0 for i in items),
        "total_year1": sum((i.data or {}).get("year1_deduction") or 0 for i in items),
        "by_category": dict(by_cat),
    }


def _build_report_html(
    project: WorkflowSession,
    prop: Optional[dict],
    items: list[WorkflowItem],
) -> str:
    from collections import defaultdict

    meta = project.meta or {}
    study_date_raw = meta.get("study_date")
    study_date_str = study_date_raw or "N/A"

    prop_name = (prop or {}).get("property_name", "N/A")
    if prop:
        prop_addr = ", ".join(filter(None, [
            prop.get("address"), prop.get("city"),
            prop.get("state"), prop.get("zip_code"),
        ]))
        prop_cost = prop.get("total_cost", 0)
    else:
        prop_addr = "N/A"
        prop_cost = 0

    by_cat: dict = defaultdict(lambda: {"label": "", "amount": 0.0, "year1": 0.0, "count": 0})
    total_cost = sum(i.amount or 0 for i in items)
    total_year1 = 0.0

    for item in items:
        d = item.data or {}
        cat_id = d.get("category_id", "needs_review")
        y1 = d.get("year1_deduction") or 0
        total_year1 += y1
        by_cat[cat_id]["label"] = d.get("category_label", cat_id)
        by_cat[cat_id]["amount"] += item.amount or 0
        by_cat[cat_id]["year1"] += y1
        by_cat[cat_id]["count"] += 1

    generated = datetime.now(timezone.utc).strftime("%B %d, %Y")

    def fmt(n: float) -> str:
        return f"${n:,.2f}"

    summary_rows = ""
    for cat_id, data in sorted(by_cat.items(), key=lambda x: -(x[1]["amount"])):
        cat_meta = CATEGORIES.get(cat_id, {})
        rp = cat_meta.get("recovery_period")
        bonus = "Yes" if cat_meta.get("bonus_eligible") else "No"
        pct = f"{data['amount'] / total_cost * 100:.1f}%" if total_cost else "0%"
        summary_rows += (
            f"<tr><td>{data['label']}</td>"
            f"<td>{f'{rp}-year' if rp else 'N/A'}</td>"
            f"<td>{bonus}</td>"
            f"<td class='num'>{fmt(data['amount'])}</td>"
            f"<td class='num'>{pct}</td>"
            f"<td class='num'>{fmt(data['year1'])}</td></tr>"
        )

    line_rows = ""
    for item in items:
        d = item.data or {}
        conf = d.get("confidence")
        conf_html = ""
        if conf is not None:
            color = "#22c55e" if conf >= 0.8 else "#f59e0b" if conf >= 0.6 else "#ef4444"
            conf_html = f"<span style='color:{color};font-weight:600'>{conf:.0%}</span>"
        edited = " <small style='color:#6366f1'>[edited]</small>" if d.get("user_edited") else ""
        rp = d.get("recovery_period")
        y1 = d.get("year1_deduction")
        line_rows += (
            f"<tr><td>{item.content or ''}{edited}</td>"
            f"<td>{d.get('category_label', '')}</td>"
            f"<td class='num'>{fmt(item.amount or 0)}</td>"
            f"<td>{f'{rp}-yr' if rp else 'N/A'}</td>"
            f"<td class='num'>{fmt(y1) if y1 is not None else 'N/A'}</td>"
            f"<td style='text-align:center'>{conf_html}</td></tr>"
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cost Segregation Study – {prop_name}</title>
<style>
  *, *::before, *::after {{ box-sizing:border-box }}
  body {{ font-family:Georgia,serif; margin:0; padding:0; color:#1a1a1a }}
  .page {{ max-width:960px; margin:0 auto; padding:48px 40px }}
  h1 {{ font-size:26px; margin:0 0 4px }}
  h2 {{ font-size:16px; color:#444; font-weight:400; margin:0 0 32px }}
  h3 {{ font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:#6b7280;
        border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin:32px 0 12px }}
  .header {{ border-bottom:3px solid #1a1a1a; padding-bottom:20px; margin-bottom:28px }}
  .grid {{ display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:32px }}
  .box {{ background:#f9f9f8; border:1px solid #e5e7eb; border-radius:8px; padding:14px 16px }}
  .box .lbl {{ font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#9ca3af; margin-bottom:4px }}
  .box .val {{ font-size:18px; font-weight:700 }}
  .box .sub {{ font-size:11px; color:#6b7280; margin-top:2px }}
  table {{ width:100%; border-collapse:collapse; font-size:13px; margin-bottom:24px }}
  th {{ background:#f3f4f6; padding:9px 12px; font-weight:600; font-size:11px;
        text-transform:uppercase; letter-spacing:.05em; color:#374151;
        border-bottom:2px solid #e5e7eb; text-align:left }}
  td {{ padding:8px 12px; border-bottom:1px solid #f3f4f6; vertical-align:top }}
  tr:hover td {{ background:#fafafa }}
  .num {{ text-align:right; font-variant-numeric:tabular-nums }}
  tfoot td {{ font-weight:700; background:#f9f9f8; border-top:2px solid #e5e7eb }}
  .disclaimer {{ font-size:11px; color:#9ca3af; margin-top:40px; padding-top:16px;
                 border-top:1px solid #e5e7eb; line-height:1.6 }}
  .stamp {{ text-align:right; font-size:11px; color:#c4b5a0; margin-top:8px }}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <h1>Cost Segregation Study</h1>
    <h2>{prop_name} &mdash; Study Date: {study_date_str}</h2>
    <div style="font-size:12px;color:#9ca3af">Generated: {generated} &bull; Project: {project.title}</div>
  </div>

  <h3>Property Overview</h3>
  <div class="grid">
    <div class="box">
      <div class="lbl">Property</div>
      <div class="val" style="font-size:14px">{prop_name}</div>
      <div class="sub">{prop_addr}</div>
    </div>
    <div class="box">
      <div class="lbl">Total Depreciable Basis</div>
      <div class="val">{fmt(total_cost)}</div>
      <div class="sub">Analyzed cost basis</div>
    </div>
    <div class="box">
      <div class="lbl">Year-1 Deductions Available</div>
      <div class="val" style="color:#16a34a">{fmt(total_year1)}</div>
      <div class="sub">vs. straight-line 39-yr: {fmt(total_cost * 0.0256)}</div>
    </div>
  </div>

  <h3>Classification Summary by Category</h3>
  <table>
    <thead><tr>
      <th>Category</th><th>Recovery Period</th><th>Bonus Eligible</th>
      <th class="num">Amount</th><th class="num">% of Total</th><th class="num">Year-1 Deduction</th>
    </tr></thead>
    <tbody>{summary_rows}</tbody>
    <tfoot><tr>
      <td colspan="3"><strong>Total</strong></td>
      <td class="num">{fmt(total_cost)}</td>
      <td class="num">100%</td>
      <td class="num">{fmt(total_year1)}</td>
    </tr></tfoot>
  </table>

  <h3>Detailed Line Items</h3>
  <table>
    <thead><tr>
      <th>Description</th><th>Category</th><th class="num">Amount</th>
      <th>Recovery</th><th class="num">Year-1 Deduction</th><th style="text-align:center">Confidence</th>
    </tr></thead>
    <tbody>{line_rows}</tbody>
    <tfoot><tr>
      <td colspan="2"><strong>Totals</strong></td>
      <td class="num">{fmt(total_cost)}</td>
      <td></td>
      <td class="num">{fmt(total_year1)}</td>
      <td></td>
    </tr></tfoot>
  </table>

  <div class="disclaimer">
    <strong>Disclaimer:</strong> This study is prepared for informational and tax planning purposes only.
    Classifications follow IRS MACRS guidelines (Rev. Proc. 87-56, IRC §168, §1245/§1250) and the CARES Act 2020 QIP correction.
    Year-1 deductions reflect standard MACRS rates plus {int(BONUS_PCT * 100)}% bonus depreciation (2026 phase-down).
    This report does not constitute legal or tax advice. Consult a qualified CPA or tax attorney before filing.
  </div>
  <div class="stamp">Cost Segregation Platform &bull; {generated}</div>
</div>
</body>
</html>"""
