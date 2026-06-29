"""
Due Diligence service — built on the generic workflow tables.

DueDiligenceStudy (due_diligence_studies) → study
DueDiligenceRule  (due_diligence_rules)   → admin-configured pass/fail criteria
Document (session_id=study.id)            → uploaded deck, term sheet, proforma, T12
WorkflowOutput (type='dd_html_report')    → generated HTML report
"""
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, update, delete

from app.core.db import db_session
from app.core.logging import get_logger
from app.models.document import Document, DocumentStatus
from app.models.due_diligence import DueDiligenceRule, DueDiligenceStudy
from app.models.workflow import WorkflowOutput
from app.services.ingestion import parse_document

logger = get_logger(__name__)

WORKFLOW_TYPE = "due_diligence"
OUTPUT_TYPE = "dd_html_report"

# ── Offering type taxonomy ─────────────────────────────────────────────────────

OFFERING_TYPES: dict[str, list[str]] = {
    "real_estate": ["multifamily"],
    "startup": ["early_stage"],
}

# ── Default rules per offering type ───────────────────────────────────────────

DEFAULT_RULES: dict[str, list[dict]] = {
    "multifamily": [
        {"rule_key": "crime_rate",     "rule_label": "Crime Rate %",             "operator": "lt",  "threshold": 5.0,     "unit": "%"},
        {"rule_key": "occupancy_rate", "rule_label": "Occupancy Rate %",         "operator": "gt",  "threshold": 90.0,    "unit": "%"},
        {"rule_key": "cap_rate",       "rule_label": "Cap Rate %",               "operator": "gt",  "threshold": 5.0,     "unit": "%"},
        {"rule_key": "vacancy_rate",   "rule_label": "Vacancy Rate %",           "operator": "lt",  "threshold": 10.0,    "unit": "%"},
        {"rule_key": "dscr",           "rule_label": "Debt Service Coverage Ratio", "operator": "gte", "threshold": 1.2, "unit": "x"},
    ],
    "early_stage": [
        {"rule_key": "runway_months",     "rule_label": "Runway (months)",       "operator": "gt",  "threshold": 12.0,    "unit": "months"},
        {"rule_key": "arr_growth_pct",    "rule_label": "ARR Growth % YoY",      "operator": "gt",  "threshold": 50.0,    "unit": "%"},
        {"rule_key": "monthly_burn_usd",  "rule_label": "Monthly Burn ($)",       "operator": "lt",  "threshold": 200000.0,"unit": "$"},
        {"rule_key": "founder_exits",     "rule_label": "Prior Founder Exits",   "operator": "gte", "threshold": 1.0,     "unit": ""},
    ],
}

# ── Study CRUD ─────────────────────────────────────────────────────────────────

async def create_study(
    session: AsyncSession,
    *,
    org_id: UUID,
    user_id: UUID,
    title: str,
    offering_category: str,
    offering_type: str,
) -> DueDiligenceStudy:
    study = DueDiligenceStudy(
        org_id=org_id,
        user_id=user_id,
        title=title,
        offering_category=offering_category,
        offering_type=offering_type,
        status="draft",
        meta={},
    )
    session.add(study)
    await session.flush()
    return study


async def list_studies(session: AsyncSession, org_id: UUID) -> list[DueDiligenceStudy]:
    result = await session.execute(
        select(DueDiligenceStudy)
        .where(DueDiligenceStudy.org_id == org_id)
        .order_by(DueDiligenceStudy.created_at.desc())
    )
    return list(result.scalars().all())


async def get_study(session: AsyncSession, study_id: UUID) -> DueDiligenceStudy:
    result = await session.execute(
        select(DueDiligenceStudy).where(DueDiligenceStudy.id == study_id)
    )
    study = result.scalars().first()
    if not study:
        raise HTTPException(status_code=404, detail="Due diligence study not found")
    return study


async def update_study(
    session: AsyncSession,
    study: DueDiligenceStudy,
    *,
    title: Optional[str] = None,
    status: Optional[str] = None,
    meta_patch: Optional[dict] = None,
) -> DueDiligenceStudy:
    if title is not None:
        study.title = title
    if status is not None:
        study.status = status
    if meta_patch:
        current_meta = dict(study.meta or {})
        current_meta.update(meta_patch)
        study.meta = current_meta
    study.updated_at = datetime.now(timezone.utc)
    session.add(study)
    await session.flush()
    return study


async def delete_study(session: AsyncSession, study_id: UUID) -> None:
    await session.execute(
        delete(WorkflowOutput).where(WorkflowOutput.session_id == study_id)
    )
    await session.execute(
        delete(Document).where(Document.tags.op("->>")("due_diligence_study_id") == str(study_id))
    )
    await session.execute(
        delete(DueDiligenceStudy).where(DueDiligenceStudy.id == study_id)
    )


# ── Deal details (stored in study.meta['details']) ─────────────────────────────

async def upsert_details(
    session: AsyncSession,
    study: DueDiligenceStudy,
    **fields: Any,
) -> dict:
    current_meta = dict(study.meta or {})
    current_details = current_meta.get("details") or {}
    updated_details = {**current_details, **fields}
    current_meta["details"] = updated_details
    study.meta = current_meta
    study.updated_at = datetime.now(timezone.utc)
    session.add(study)
    await session.flush()
    return updated_details


def get_details_from_meta(study: DueDiligenceStudy) -> Optional[dict]:
    return (study.meta or {}).get("details")


# ── Documents ─────────────────────────────────────────────────────────────────

async def create_due_diligence_doc(
    session: AsyncSession,
    *,
    study_id: UUID,
    org_id: UUID,
    user_id: UUID,
    filename: str,
    doc_label: Optional[str] = None,
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
        session_id=None,
        tags={"due_diligence_study_id": str(study_id)},
    )
    session.add(doc)
    await session.flush()
    return doc


async def list_due_diligence_docs(session: AsyncSession, study_id: UUID) -> list[Document]:
    result = await session.execute(
        select(Document)
        .where(Document.tags.op("->>")("due_diligence_study_id") == str(study_id))
        .order_by(Document.created_at)
    )
    return list(result.scalars().all())


async def delete_due_diligence_doc(session: AsyncSession, doc_id: UUID) -> Document:
    result = await session.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalars().first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    await session.delete(doc)
    await session.flush()
    return doc


# ── Rule evaluation ────────────────────────────────────────────────────────────

_OPERATORS = {
    "lt":  lambda a, b: a < b,
    "gt":  lambda a, b: a > b,
    "lte": lambda a, b: a <= b,
    "gte": lambda a, b: a >= b,
    "eq":  lambda a, b: a == b,
}


async def evaluate_rules(
    session: AsyncSession,
    study: DueDiligenceStudy,
) -> list[dict]:
    """
    Load enabled DueDiligenceRules for this org+offering_type, compare against
    study.meta['rule_values'] extracted by the AI, return a scorecard list.
    """
    result = await session.execute(
        select(DueDiligenceRule).where(
            DueDiligenceRule.org_id == study.org_id,
            DueDiligenceRule.offering_type == study.offering_type,
            DueDiligenceRule.enabled == True,  # noqa: E712
        )
    )
    rules = result.scalars().all()

    rule_values: dict = (study.meta or {}).get("rule_values", {})
    scorecard = []
    for rule in rules:
        actual = rule_values.get(rule.rule_key)
        if actual is None:
            passed = None  # could not extract this metric
        else:
            try:
                op_fn = _OPERATORS.get(rule.operator)
                passed = bool(op_fn(float(actual), rule.threshold)) if op_fn else None
            except (TypeError, ValueError):
                passed = None

        scorecard.append({
            "rule_id": str(rule.id),
            "rule_key": rule.rule_key,
            "rule_label": rule.rule_label,
            "operator": rule.operator,
            "threshold": rule.threshold,
            "unit": rule.unit or "",
            "actual_value": actual,
            "passed": passed,
        })
    return scorecard


# ── Report ─────────────────────────────────────────────────────────────────────

async def generate_report(
    session: AsyncSession,
    study: DueDiligenceStudy,
    org_id: UUID,
    reviewer_name: str,
    reviewer_email: str,
    watermark_label: str = "CONFIDENTIAL",
) -> str:
    """Generate HTML report via Claude Skills, store in WorkflowOutput, return HTML."""
    from app.core.config import settings
    from app.integrations.claude_skills import ClaudeSkillsClient

    details = get_details_from_meta(study) or {}
    metrics = (study.meta or {}).get("metrics", {})
    scorecard = await evaluate_rules(session, study)

    html: Optional[str] = None

    if settings.ANTHROPIC_API_KEY and settings.CLAUDE_SKILLS_DUE_DILIGENCE_ID:
        try:
            client = ClaudeSkillsClient(
                api_key=settings.ANTHROPIC_API_KEY,
                skill_id=settings.CLAUDE_SKILLS_DUE_DILIGENCE_ID,
                skill_version=settings.CLAUDE_SKILLS_DUE_DILIGENCE_VERSION,
                model=settings.CLAUDE_SKILLS_MODEL,
                base_url=settings.ANTHROPIC_BASE_URL,
                workspace_id=settings.ANTHROPIC_WORKSPACE_ID,
            )
            timestamp = datetime.now(timezone.utc).strftime("%m/%d/%Y %H:%M UTC")
            data = {
                "study_title": study.title,
                "offering_category": study.offering_category,
                "offering_type": study.offering_type,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "details": details,
                "metrics": metrics,
                "scorecard": scorecard,
                "watermark_label": watermark_label,
                "reviewer_name": reviewer_name,
                "reviewer_email": reviewer_email,
                "timestamp": timestamp,
            }
            result = await client.generate_report(
                data,
                prompt_instruction="Generate a highly detailed due diligence report from the following extracted metrics and scorecard. Save the HTML report to /output/report.html"
            )
            html = result.get("html")
        except Exception as e:
            logger.exception("Claude Skills DD report generation failed, using fallback: %s", str(e))

    if html is None:
        html = _build_fallback_report(study, details, metrics, scorecard, reviewer_name, reviewer_email, watermark_label)

    # Save to study.meta instead of workflow_outputs
    current_meta = dict(study.meta or {})
    current_meta["report_html"] = html
    study.meta = current_meta
    study.updated_at = datetime.now(timezone.utc)
    session.add(study)
    await session.flush()
    return html


async def get_report(session: AsyncSession, study_id: UUID) -> Optional[dict]:
    study = await get_study(session, study_id)
    html = (study.meta or {}).get("report_html")
    if not html:
        return None
    return {
        "content": html,
        "generated_at": study.updated_at or study.created_at
    }


def _build_fallback_report(
    study: DueDiligenceStudy,
    details: dict,
    metrics: dict,
    scorecard: list[dict],
    reviewer_name: str,
    reviewer_email: str,
    watermark_label: str,
) -> str:
    """Minimal HTML report fallback when Claude Skills is unavailable."""
    timestamp = datetime.now(timezone.utc).strftime("%m/%d/%Y %H:%M UTC")
    stamp = f"{watermark_label} — {reviewer_name} / {reviewer_email} / {timestamp}"
    offering_label = study.offering_type.replace("_", " ").title()

    score_rows = ""
    for item in scorecard:
        status_icon = "✅" if item["passed"] else ("❌" if item["passed"] is False else "⚠️")
        actual = f"{item['actual_value']} {item['unit']}" if item["actual_value"] is not None else "Not extracted"
        threshold = f"{item['operator'].upper()} {item['threshold']} {item['unit']}"
        score_rows += f"<tr><td>{item['rule_label']}</td><td>{threshold}</td><td>{actual}</td><td>{status_icon}</td></tr>\n"

    details_rows = "".join(
        f"<tr><td><strong>{k.replace('_', ' ').title()}</strong></td><td>{v}</td></tr>"
        for k, v in details.items()
        if v is not None
    )

    import urllib.parse
    encoded_label = urllib.parse.quote(watermark_label)
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><text x='50%' y='50%' font-size='60' fill='rgba(200,0,0,0.06)' font-family='sans-serif' font-weight='bold' text-anchor='middle' dominant-baseline='middle' transform='rotate(-45 300 300)'>{encoded_label}</text></svg>"
    svg_data = f"data:image/svg+xml;utf8,{svg}"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Due Diligence Report — {study.title}</title>
<style>
  body {{ 
    font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; color: #1a1a2e;
    background-image: url("{svg_data}");
    background-repeat: repeat;
    background-attachment: fixed;
  }}
  .page {{ max-width: 900px; margin: 0 auto; padding: 40px; background: rgba(255, 255, 255, 0.95); }}
  .cover {{ background: linear-gradient(135deg, #0f3460 0%, #16213e 100%); color: white;
            padding: 80px 60px; min-height: 300px; position: relative; }}
  .cover h1 {{ font-size: 2.5rem; margin: 0 0 10px 0; }}
  .cover .subtitle {{ font-size: 1.2rem; opacity: 0.8; margin: 0; }}
  .stamp {{ font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 40px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 15px; }}
  .section {{ margin: 40px 0; }}
  .section h2 {{ color: #0f3460; border-bottom: 2px solid #e8f0fe; padding-bottom: 8px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 20px 0; background: white; }}
  th {{ background: #0f3460; color: white; padding: 10px 14px; text-align: left; font-size: 13px; }}
  td {{ padding: 9px 14px; border-bottom: 1px solid #e8f0fe; font-size: 13px; }}
  tr:nth-child(even) td {{ background: #f8faff; }}
  .page-footer {{ font-size: 10px; color: #888; text-align: center; margin-top: 60px;
                  border-top: 1px solid #e0e0e0; padding-top: 12px; }}
  .badge {{ display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; }}
  .badge-re {{ background: #e8f5e9; color: #2e7d32; }}
  .badge-su {{ background: #e3f2fd; color: #1565c0; }}
</style>
</head>
<body>
<div class="cover">
  <p style="opacity:0.7; font-size:12px; margin:0 0 20px 0;">{watermark_label}</p>
  <h1>Diligence Report — {study.title}</h1>
  <p class="subtitle">{offering_label} • {datetime.now(timezone.utc).strftime('%B %Y')}</p>
  <div class="stamp">{stamp}<br>{stamp}</div>
</div>
<div class="page">
  <div class="section">
    <h2>Deal Details</h2>
    <table><tbody>{details_rows}</tbody></table>
  </div>
  <div class="section">
    <h2>Rule-Based Scorecard</h2>
    <table>
      <thead><tr><th>Criteria</th><th>Threshold</th><th>Actual</th><th>Status</th></tr></thead>
      <tbody>{score_rows}</tbody>
    </table>
  </div>
  <div class="section">
    <h2>Analysis Note</h2>
    <p>This report was generated using available data. Full AI-powered analysis and market research
    are included in the paid report.</p>
  </div>
  <div class="page-footer">{stamp} | Page 1</div>
</div>
</body>
</html>"""


# ── Rules CRUD ─────────────────────────────────────────────────────────────────

async def list_rules(
    session: AsyncSession,
    org_id: UUID,
    offering_type: Optional[str] = None,
) -> list[DueDiligenceRule]:
    q = select(DueDiligenceRule).where(
        DueDiligenceRule.org_id == org_id
    ).order_by(DueDiligenceRule.offering_type, DueDiligenceRule.created_at)
    if offering_type:
        q = q.where(DueDiligenceRule.offering_type == offering_type)
    result = await session.execute(q)
    return list(result.scalars().all())


async def get_rule(session: AsyncSession, rule_id: UUID, org_id: UUID) -> DueDiligenceRule:
    result = await session.execute(
        select(DueDiligenceRule).where(
            DueDiligenceRule.id == rule_id,
            DueDiligenceRule.org_id == org_id,
        )
    )
    rule = result.scalars().first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


async def create_rule(
    session: AsyncSession,
    org_id: UUID,
    offering_category: str,
    offering_type: str,
    rule_key: str,
    rule_label: str,
    operator: str,
    threshold: float,
    unit: Optional[str] = None,
    enabled: bool = True,
) -> DueDiligenceRule:
    rule = DueDiligenceRule(
        org_id=org_id,
        offering_category=offering_category,
        offering_type=offering_type,
        rule_key=rule_key,
        rule_label=rule_label,
        operator=operator,
        threshold=threshold,
        unit=unit,
        enabled=enabled,
    )
    session.add(rule)
    await session.flush()
    return rule


async def update_rule(
    session: AsyncSession,
    rule: DueDiligenceRule,
    *,
    rule_label: Optional[str] = None,
    operator: Optional[str] = None,
    threshold: Optional[float] = None,
    unit: Optional[str] = None,
    enabled: Optional[bool] = None,
) -> DueDiligenceRule:
    if rule_label is not None:
        rule.rule_label = rule_label
    if operator is not None:
        rule.operator = operator
    if threshold is not None:
        rule.threshold = threshold
    if unit is not None:
        rule.unit = unit
    if enabled is not None:
        rule.enabled = enabled
    rule.updated_at = datetime.now(timezone.utc)
    session.add(rule)
    await session.flush()
    return rule


async def delete_rule(session: AsyncSession, rule_id: UUID) -> None:
    await session.execute(
        delete(DueDiligenceRule).where(DueDiligenceRule.id == rule_id)
    )


async def seed_default_rules(
    session: AsyncSession,
    org_id: UUID,
) -> list[DueDiligenceRule]:
    """Seed default rules for all offering types for an org (idempotent by rule_key + offering_type)."""
    created: list[DueDiligenceRule] = []
    category_map = {"multifamily": "real_estate", "early_stage": "startup"}

    for offering_type, defaults in DEFAULT_RULES.items():
        offering_category = category_map[offering_type]
        for d in defaults:
            # Check if rule_key already exists for this org+offering_type
            exists = await session.execute(
                select(DueDiligenceRule).where(
                    DueDiligenceRule.org_id == org_id,
                    DueDiligenceRule.offering_type == offering_type,
                    DueDiligenceRule.rule_key == d["rule_key"],
                )
            )
            if exists.scalars().first():
                continue  # Skip — already seeded
            rule = DueDiligenceRule(
                org_id=org_id,
                offering_category=offering_category,
                offering_type=offering_type,
                **d,
            )
            session.add(rule)
            await session.flush()
            created.append(rule)
    return created
