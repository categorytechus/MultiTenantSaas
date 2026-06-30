"""
Arq job for Due Diligence Analysis.

run_due_diligence:
  1. Download all study documents from S3
  2. Extract text (PDF / DOCX / etc.)
  3. Call Claude Skills due_diligence skill with offering type context +
     document text + autonomous market research instruction
  4. Parse structured output: deal metrics, scorecard values, HTML report
  5. Store metrics in study.meta['metrics'] and rule_values in study.meta['rule_values']
  6. Store HTML report via WorkflowOutput
  7. Update study status → analysis_complete
  8. Call internal task callback → triggers email notification
"""
import asyncio
import datetime
import json
import logging
import re
from typing import Any

import httpx
import psycopg
from psycopg.types.json import Jsonb

from app.config import settings
from app.http import update_task
from app.redis import publish, task_channel
from app.s3 import download as s3_download

logger = logging.getLogger(__name__)


def _clean_json(raw: str) -> Any:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-z]*\n?", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\n?```$", "", cleaned)
    cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(1))


async def _set_study_status(db_url: str, org_id: str, study_id: str, status: str) -> None:
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            await conn.execute(
                """
                UPDATE due_diligence_studies
                SET status = %s, updated_at = now()
                WHERE id = %s::uuid AND org_id = %s::uuid
                """,
                [status, study_id, org_id],
            )


async def _load_study(db_url: str, org_id: str, study_id: str) -> dict[str, Any]:
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            cur = await conn.execute(
                """
                SELECT title, offering_category, offering_type, meta
                FROM due_diligence_studies
                WHERE id = %s::uuid AND org_id = %s::uuid
                """,
                [study_id, org_id],
            )
            row = await cur.fetchone()
    if not row:
        raise ValueError(f"Due diligence study {study_id} not found")
    return {
        "title": row[0],
        "offering_category": row[1],
        "offering_type": row[2],
        "meta": row[3] or {},
    }


async def _load_study_docs(db_url: str, org_id: str, study_id: str) -> list[tuple]:
    """Return (doc_id, filename, s3_key, mime_type) for all docs linked to study."""
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            cur = await conn.execute(
                "SELECT id, filename, s3_key, mime_type FROM documents WHERE session_id = %s::uuid",
                [study_id],
            )
            return await cur.fetchall()


async def _store_study_meta(
    db_url: str,
    org_id: str,
    study_id: str,
    meta_patch: dict[str, Any],
) -> None:
    """Merge meta_patch into study.meta JSONB using PostgreSQL || operator."""
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            await conn.execute(
                """
                UPDATE due_diligence_studies
                SET meta = COALESCE(meta, '{}') || %s::jsonb,
                    updated_at = now()
                WHERE id = %s::uuid AND org_id = %s::uuid
                """,
                [Jsonb(meta_patch), study_id, org_id],
            )

_OPERATORS = {
    "lt":  lambda a, b: a < b,
    "gt":  lambda a, b: a > b,
    "lte": lambda a, b: a <= b,
    "gte": lambda a, b: a >= b,
    "eq":  lambda a, b: a == b,
}

async def _evaluate_rules(db_url: str, org_id: str, offering_type: str, rule_values: dict) -> list[dict]:
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            cur = await conn.execute(
                "SELECT id, rule_key, rule_label, operator, threshold, unit FROM due_diligence_rules WHERE org_id = %s::uuid AND offering_type = %s AND enabled = true",
                [org_id, offering_type],
            )
            rules = await cur.fetchall()

    scorecard = []
    for rule in rules:
        r_id, r_key, r_label, r_op, r_thresh, r_unit = rule
        actual = rule_values.get(r_key)
        if actual is None:
            passed = None
        else:
            try:
                op_fn = _OPERATORS.get(r_op)
                passed = bool(op_fn(float(actual), float(r_thresh))) if op_fn else None
            except (TypeError, ValueError):
                passed = None
                
        scorecard.append({
            "rule_id": str(r_id),
            "rule_key": r_key,
            "rule_label": r_label,
            "operator": r_op,
            "threshold": float(r_thresh) if r_thresh is not None else None,
            "unit": r_unit or "",
            "actual_value": actual,
            "passed": passed,
        })
    return scorecard


async def _load_org_config(db_url: str, org_id: str) -> dict[str, Any]:
    """Fetch due_diligence_report_config from the org record."""
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            cur = await conn.execute(
                "SELECT due_diligence_report_config FROM orgs WHERE id = %s::uuid",
                [org_id],
            )
            row = await cur.fetchone()
    return (row[0] or {}) if row else {}


async def _load_user_for_task(db_url: str, task_id: str) -> tuple[str, str]:
    """Fetch user name and email from the agent task."""
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            cur = await conn.execute(
                """
                SELECT u.name, u.email
                FROM agent_tasks t
                JOIN users u ON u.id = t.user_id
                WHERE t.id = %s::uuid
                """,
                [task_id],
            )
            row = await cur.fetchone()
    if not row:
        return "System Auto-Generator", ""
    name = (row[0] or "").strip()
    return name or "System Auto-Generator", row[1] or ""


async def run_due_diligence(
    ctx: dict[str, Any],
    *,
    task_id: str,
    org_id: str,
    study_id: str,
) -> None:
    """
    Arq job: Run autonomous due diligence analysis for a study.
    Pipeline: download docs → extract text → Claude Skills analysis → store results.
    """
    redis = ctx["redis"]
    http = ctx["http"]
    channel = task_channel(org_id, task_id)
    db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    await update_task(http, task_id, org_id, "running")
    await publish(redis, channel, {"type": "progress", "message": "Starting due diligence analysis..."})

    try:
        # 1. Load study
        await publish(redis, channel, {"type": "progress", "message": "Loading study details..."})
        study = await _load_study(db_url, org_id, study_id)
        offering_type = study["offering_type"]
        offering_category = study["offering_category"]
        study_meta = study["meta"]
        details = study_meta.get("details", {})

        # 2. Load and extract document text
        await publish(redis, channel, {"type": "progress", "message": "Fetching uploaded documents..."})
        await _set_study_status(db_url, org_id, study_id, "analyzing")

        docs = await _load_study_docs(db_url, org_id, study_id)
        text_parts: list[str] = []

        for doc_id, filename, s3_key, mime_type in docs:
            await publish(redis, channel, {"type": "progress", "message": f"Parsing {filename}..."})
            try:
                if not s3_key:
                    logger.warning(f"No S3 key for doc {filename}, skipping")
                    continue
                body = await s3_download(s3_key)
                from app.jobs.ingest import parse_document
                text = await asyncio.to_thread(parse_document, body, mime_type)
                if text.strip():
                    text_parts.append(f"--- {filename} ---\n{text[:200000]}")
            except Exception as e:
                logger.error(f"Failed to parse document {filename}: {e}")

        combined_text = "\n\n".join(text_parts) if text_parts else "[No documents could be parsed]"

        # 3. Load org report config for watermark
        await publish(redis, channel, {"type": "progress", "message": "Loading organization settings..."})
        org_config = await _load_org_config(db_url, org_id)
        watermark_label = org_config.get("watermark_label") or "CONFIDENTIAL"

        # 4. Call Claude Skills for autonomous analysis + report generation
        await publish(redis, channel, {"type": "progress", "message": "Running AI-powered due diligence analysis..."})

        analysis_result = await _run_claude_skills_analysis(
            offering_category=offering_category,
            offering_type=offering_type,
            study_title=study["title"],
            details=details,
            combined_text=combined_text,
            watermark_label=watermark_label,
        )

        # 5. Store extracted metrics and rule values
        await publish(redis, channel, {"type": "progress", "message": "Storing analysis results..."})
        meta_patch: dict[str, Any] = {}
        if analysis_result.get("metrics"):
            meta_patch["metrics"] = analysis_result["metrics"]
        if analysis_result.get("rule_values"):
            meta_patch["rule_values"] = analysis_result["rule_values"]
        if meta_patch:
            await _store_study_meta(db_url, org_id, study_id, meta_patch)

        # 6. Store HTML report if generated
        if analysis_result.get("html"):
            await publish(redis, channel, {"type": "progress", "message": "Saving report..."})
            await _store_study_meta(db_url, org_id, study_id, {"report_html": analysis_result["html"]})

        # 7. Update study status → analysis_complete
        await _set_study_status(db_url, org_id, study_id, "analysis_complete")

        await update_task(http, task_id, org_id, "succeeded", output={
            "study_id": study_id,
            "metrics_extracted": bool(analysis_result.get("metrics")),
            "report_generated": bool(analysis_result.get("html")),
        })
        await publish(redis, channel, {"type": "progress", "message": "✅ Due diligence analysis complete!"})
        await publish(redis, channel, {"type": "done"})
        logger.info("Due diligence analysis complete", extra={"task_id": task_id, "study_id": study_id})

    except Exception as exc:
        logger.error(f"Due diligence job failed: {exc}", exc_info=True)
        try:
            await _set_study_status(db_url, org_id, study_id, "documents_uploaded")
        except Exception:
            logger.warning("Failed to reset study status after DD failure.", exc_info=True)
        await publish(redis, channel, {"type": "error", "data": str(exc)})
        await update_task(http, task_id, org_id, "failed", error=str(exc))
        raise


async def _run_claude_skills_analysis(
    *,
    offering_category: str,
    offering_type: str,
    study_title: str,
    details: dict[str, Any],
    combined_text: str,
    watermark_label: str,
) -> dict[str, Any]:
    """
    Call LLM to extract metrics and scorecard for Due Diligence.
    Does NOT generate the HTML report.
    """
    from app.integrations.llm import llm

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%m/%d/%Y %H:%M UTC")

    # Use LLM directly to extract metrics and generate minimal analysis
    return await _llm_fallback_analysis(
        offering_category=offering_category,
        offering_type=offering_type,
        study_title=study_title,
        details=details,
        combined_text=combined_text,
        watermark_label=watermark_label,
        timestamp=timestamp,
        llm=llm,
    )


async def _llm_fallback_analysis(
    *,
    offering_category: str,
    offering_type: str,
    study_title: str,
    details: dict[str, Any],
    combined_text: str,
    watermark_label: str,
    timestamp: str,
    llm: Any,
) -> dict[str, Any]:
    """
    Fallback LLM analysis when Claude Skills is not configured.
    Extracts key metrics and generates a structured JSON output.
    """
    if offering_type == "multifamily":
        metric_fields = [
            "occupancy_rate (as a percentage, e.g. 92.5)",
            "crime_rate (as a percentage of area average, e.g. 3.2)",
            "cap_rate (as a percentage, e.g. 5.8)",
            "vacancy_rate (as a percentage, e.g. 7.5)",
            "dscr (as a decimal ratio, e.g. 1.35)",
            "noi (as a dollar amount, e.g. 450000)",
            "asking_price (as a dollar amount)",
            "units (integer count)",
        ]
        sections = ["Property Overview", "Market Analysis", "Financial Analysis", "Risk Factors", "Recommendation"]
    else:  # early_stage
        metric_fields = [
            "arr_usd (ARR in dollars, e.g. 1500000)",
            "monthly_burn_usd (monthly burn in dollars, e.g. 120000)",
            "runway_months (months of runway, e.g. 18)",
            "arr_growth_pct (ARR growth % YoY, e.g. 150)",
            "founder_exits (number of prior exits, e.g. 1)",
        ]
        sections = ["Deal Overview", "Market & Competition", "Company Traction", "Team Assessment", "Risk Factors", "Recommendation"]

    system_prompt = f"""You are a professional investment analyst performing due diligence on a {offering_type.replace('_', ' ')} investment opportunity.

Analyze the provided documents and deal details. Perform your own market research reasoning based on the information provided.

Return ONLY a JSON object with this structure:
{{
  "metrics": {{
    // Key financial/operational metrics extracted from documents
    // Keys match the expected metrics for this offering type
  }},
  "rule_values": {{
    // Same as metrics but specifically the values needed for rule evaluation:
    {chr(10).join(f'    // {f}' for f in metric_fields)}
  }},
  "sections": {{
    // One paragraph per section: {', '.join(sections)}
    "section_name": "narrative text..."
  }},
  "overall_score": 75,  // 0-100
  "recommendation": "Proceed with Investment" // or "Pass" or "More Diligence Required"
}}

Deal details provided: {json.dumps(details, indent=2)}"""

    user_prompt = f"""Analyze this {offering_type.replace('_', ' ')} investment:\n\nTitle: {study_title}\n\nDocument content:\n{combined_text[:100000]}"""

    try:
        raw = await llm.complete([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ])
        parsed = _clean_json(raw)
        if not isinstance(parsed, dict):
            parsed = {}
    except Exception as e:
        logger.warning(f"LLM fallback analysis failed: {e}")
        parsed = {}

    return {
        "metrics": parsed.get("metrics", {}),
        "rule_values": parsed.get("rule_values", {}),
        "html": None,  # No HTML from LLM fallback — server will generate via template
    }


def _build_fallback_report(
    study_title: str,
    details: dict,
    metrics: dict,
    scorecard: list[dict],
    reviewer_name: str,
    reviewer_email: str,
    watermark_label: str,
) -> str:
    """Minimal HTML report fallback when Claude Skills is unavailable."""
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%m/%d/%Y %H:%M UTC")
    stamp = f"{watermark_label} — {reviewer_name} / {reviewer_email} / {timestamp}"

    score_rows = ""
    for item in scorecard:
        status_icon = "✅" if item.get("passed") else ("❌" if item.get("passed") is False else "⚠️")
        actual = f"{item.get('actual_value')} {item.get('unit')}" if item.get("actual_value") is not None else "Not extracted"
        threshold = f"{item.get('operator', '').upper()} {item.get('threshold')} {item.get('unit', '')}"
        score_rows += f"<tr><td>{item.get('rule_label', 'Rule')}</td><td>{threshold}</td><td>{actual}</td><td>{status_icon}</td></tr>\n"

    details_rows = "".join(
        f"<tr><td><strong>{k.replace('_', ' ').title()}</strong></td><td>{v}</td></tr>"
        for k, v in details.items()
        if v is not None
    )


    watermark_html = f"""
    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); 
                font-size: 100px; font-weight: bold; color: rgba(128,128,128,0.1); text-align: center; 
                pointer-events: none; z-index: 9999; user-select: none;">
      {watermark_label}<br>
      <span style="font-size: 30px; font-weight: normal;">{reviewer_email}</span><br>
      <span style="font-size: 30px; font-weight: normal;">{timestamp}</span>
    </div>
    """

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Due Diligence Report — {study_title}</title>
<style>
  body {{ 
    font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; color: #1a1a2e;
  }}
  .container {{ max-width: 800px; margin: 0 auto; padding: 40px; background: rgba(255, 255, 255, 0.95); }}
  h1 {{ border-bottom: 2px solid #eaeaea; padding-bottom: 10px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; background: white; }}
  th, td {{ border: 1px solid #eaeaea; padding: 12px; text-align: left; }}
  th {{ background: #f9f9fa; font-weight: 600; }}
  .footer { margin-top: 50px; font-size: 12px; color: #888; text-align: center; border-top: 1px solid #eaeaea; padding-top: 20px; }
</style>
</head>
<body>
  {watermark_html}
  <div class="container">
    <h1>Due Diligence Summary</h1>
    <h3>{study_title}</h3>
    
    <h2>Deal Details</h2>
    <table><tbody>{details_rows}</tbody></table>

    <h2>Rule Evaluation Scorecard</h2>
    <table>
      <thead><tr><th>Rule</th><th>Threshold</th><th>Extracted Value</th><th>Pass</th></tr></thead>
      <tbody>{score_rows}</tbody>
    </table>
    
    <div class="footer">
      Generated automatically by Kolmio Due Diligence Engine.<br>
      {stamp}
    </div>
  </div>
</body>
</html>
"""

async def run_due_diligence_report(
    ctx: dict[str, Any],
    *,
    task_id: str,
    org_id: str,
    study_id: str,
) -> None:
    """
    Arq job: Generate the HTML due diligence report in the background after payment.
    """
    redis = ctx["redis"]
    http = ctx["http"]
    channel = task_channel(org_id, task_id)
    db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    await update_task(http, task_id, org_id, "running")
    await publish(redis, channel, {"type": "progress", "message": "Initializing report generation..."})

    try:
        study = await _load_study(db_url, org_id, study_id)
        if not study:
            raise ValueError(f"Study {study_id} not found")

        study_meta = study["meta"]
        details = study_meta.get("details", {})
        metrics = study_meta.get("metrics", {})
        rule_values = study_meta.get("rule_values", {})
        
        # Evaluate rules to create scorecard
        scorecard = await _evaluate_rules(db_url, org_id, study["offering_type"], rule_values)

        # Parse documents to get combined text
        docs = await _load_study_docs(db_url, org_id, study_id)
        text_parts: list[str] = []
        for doc_id, filename, s3_key, mime_type in docs:
            if not s3_key: continue
            try:
                body = await s3_download(s3_key)
                from app.jobs.ingest import parse_document
                text = await asyncio.to_thread(parse_document, body, mime_type)
                if text.strip():
                    text_parts.append(f"--- {filename} ---\n{text[:200000]}")
            except Exception as e:
                logger.error(f"Failed to parse document {filename}: {e}")
        combined_text = "\n\n".join(text_parts) if text_parts else "[No documents could be parsed]"
        
        reviewer_name, reviewer_email = await _load_user_for_task(db_url, task_id)

        org_config = await _load_org_config(db_url, org_id)
        watermark_label = org_config.get("watermark_label") or "CONFIDENTIAL"
        
        html: str | None = None
        
        if settings.ANTHROPIC_API_KEY and settings.CLAUDE_SKILLS_DUE_DILIGENCE_ID:
            from app.integrations.claude_skills import ClaudeSkillsClient
            try:
                await publish(redis, channel, {"type": "progress", "message": "Calling Claude Skills..."})
                client = ClaudeSkillsClient(
                    api_key=settings.ANTHROPIC_API_KEY,
                    skill_id=settings.CLAUDE_SKILLS_DUE_DILIGENCE_ID,
                    skill_version=settings.CLAUDE_SKILLS_DUE_DILIGENCE_VERSION,
                    model=settings.CLAUDE_SKILLS_MODEL,
                    base_url=settings.ANTHROPIC_BASE_URL,
                    workspace_id=settings.ANTHROPIC_WORKSPACE_ID,
                )
                
                timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%m/%d/%Y %H:%M UTC")
                
                data = {
                    "study_title": study["title"],
                    "offering_category": study["offering_category"],
                    "offering_type": study["offering_type"],
                    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "details": details,
                    "metrics": metrics,
                    "scorecard": scorecard,
                    "watermark_label": watermark_label,
                    "reviewer_name": reviewer_name,
                    "reviewer_email": reviewer_email,
                    "timestamp": timestamp,
                }
                
                try:
                    guideline_bytes = await s3_download("global/market_research_guidelines.txt")
                    guidelines = guideline_bytes.decode("utf-8").strip()
                except Exception as e:
                    logger.warning("Could not load global market research guidelines: %s", e)
                    guidelines = ""
                
                instruction = (
                    "Generate a highly detailed, professional due diligence report in HTML format. "
                    "Use the provided extracted metrics, scorecard, and the full text of the uploaded documents "
                    "in `document_content` to write deep, multi-paragraph analysis for each section. "
                )
                if guidelines:
                    instruction += (
                        "\n\nCRITICAL: Adhere to the following custom market research guidelines when analyzing companies and websites:\n"
                        f"{guidelines}\n\n"
                    )
                instruction += (
                    "CRITICAL INSTRUCTION: Do NOT generate any watermarks, overlays, or footer stamps whatsoever. "
                    "Our system will inject the watermarks later. "
                    "CRITICAL INSTRUCTION: You MUST ONLY write `report.html` to disk. Do NOT write `data.json`. "
                    "Our backend pipeline will crash if you output more than one file. "
                    "Save the HTML report to /output/report.html"
                )
                
                result = await client.generate_report(
                    data,
                    prompt_instruction=instruction,
                    document_text=combined_text
                )
                html = result.get("html")
                if html:
                    
                    # Inject watermark programmatically
                    watermark_html = f"""
                    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-45deg); font-size: 100px; font-weight: bold; color: rgba(128,128,128,0.1); text-align: center; pointer-events: none; z-index: 9999; user-select: none;">
                        {watermark_label}<br>
                        <span style="font-size: 30px; font-weight: normal;">{reviewer_email}</span><br>
                        <span style="font-size: 30px; font-weight: normal;">{timestamp}</span>
                    </div>
                    """
                    if "</body>" in html:
                        html = html.replace("</body>", f"{watermark_html}\n</body>")
                    else:
                        html += watermark_html
                        
                    await publish(redis, channel, {"type": "progress", "message": "Applying watermark and saving..."})
                    import urllib.parse
                    encoded_label = urllib.parse.quote(watermark_label)
                    encoded_email = urllib.parse.quote(reviewer_email)
                    encoded_time = urllib.parse.quote(timestamp)
                    svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><g transform='translate(300 300) rotate(-45)'><text x='0' y='-20' font-size='60' fill='rgba(128,128,128,0.1)' font-family='sans-serif' font-weight='bold' text-anchor='middle'>{encoded_label}</text><text x='0' y='20' font-size='30' fill='rgba(128,128,128,0.1)' font-family='sans-serif' text-anchor='middle'>{encoded_email}</text><text x='0' y='60' font-size='30' fill='rgba(128,128,128,0.1)' font-family='sans-serif' text-anchor='middle'>{encoded_time}</text></g></svg>"
                    svg_data = f"data:image/svg+xml;utf8,{svg}"
                    css_injection = f"""<style>
.watermark-overlay {{ display: none !important; }}
body {{ background-image: url("{svg_data}") !important; background-repeat: repeat !important; background-attachment: fixed !important; }}
</style>"""
                    if "</head>" in html:
                        html = html.replace("</head>", f"{css_injection}\n</head>")
                    else:
                        html = f"{css_injection}\n{html}"
            except Exception as e:
                logger.exception(f"Claude Skills DD report generation failed, using fallback: {e}")

        if not html:
            await publish(redis, channel, {"type": "progress", "message": "Using fallback report generator..."})
            html = _build_fallback_report(
                study["title"], details, metrics, scorecard,
                reviewer_name, reviewer_email, watermark_label
            )

        await publish(redis, channel, {"type": "progress", "message": "Saving report HTML to database..."})
        await _store_study_meta(db_url, org_id, study_id, {"report_html": html})
        await _set_study_status(db_url, org_id, study_id, "report_ready")

        await update_task(http, task_id, org_id, "succeeded", output={
            "study_id": study_id,
            "report_generated": True
        })
        await publish(redis, channel, {"type": "progress", "message": "Report generation complete!"})

    except Exception as exc:
        logger.exception("Failed to generate due diligence report")
        await update_task(http, task_id, org_id, "failed", error=str(exc))
        await publish(redis, channel, {"type": "progress", "message": f"Error: {exc}"})
        raise
