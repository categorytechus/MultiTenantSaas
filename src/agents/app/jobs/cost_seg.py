"""
Arq jobs for Cost Segregation Agent.

Phase 1: run_extraction  — extract raw cost line items from documents.
Phase 2: run_classification — classify items using JSON ruleset + LLM.
Phase 3: run_report      — generate HTML/PDF report via Claude Skills.
"""
import datetime
import json
import logging
import re
import uuid
from typing import Any
from arq.connections import create_pool, RedisSettings
from bs4 import BeautifulSoup
import httpx
import psycopg
from psycopg.types.json import Jsonb

from app.integrations.llm import llm
from app.config import settings
from app.redis import publish, task_channel
from app.http import update_task

logger = logging.getLogger(__name__)

ITEM_TYPE = "line_item"

from app.jobs.ingest import parse_document
from app.s3 import download as s3_download, upload as s3_upload
from app.jobs.pdf_gen import PDFGenerator

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


async def run_extraction(
    ctx: dict[str, Any],
    *,
    task_id: str,
    org_id: str,
    project_id: str,
) -> None:
    redis = ctx["redis"]
    http = ctx["http"]
    channel = task_channel(org_id, task_id)

    await update_task(http, task_id, org_id, "running")
    await publish(redis, channel, {"type": "progress", "message": "Starting cost line items extraction..."})

    try:
        # 1. Fetch all documents associated with the project/session
        await publish(redis, channel, {"type": "progress", "message": "Fetching project documents..."})
        db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
        
        # Immediately set status to analyzing so frontend polling doesn't abort
        await _set_project_status(db_url, org_id, project_id, "analyzing")

        docs = []
        chunks = []
        async with await psycopg.AsyncConnection.connect(db_url) as conn:
            async with conn.transaction():
                # Set RLS context
                await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
                
                # Fetch documents
                cur = await conn.execute(
                    "SELECT id, filename, s3_key, mime_type, document_type, source_url FROM documents WHERE session_id = %s::uuid",
                    [project_id]
                )
                docs = await cur.fetchall()
                
                # Fetch pre-existing chunks
                chunks_cur = await conn.execute(
                    """
                    SELECT dc.content, dc.chunk_index, d.filename
                    FROM document_chunks dc
                    JOIN documents d ON d.id = dc.document_id
                    WHERE d.session_id = %s::uuid
                    ORDER BY dc.document_id, dc.chunk_index
                    """,
                    [project_id]
                )
                chunks = await chunks_cur.fetchall()

        if not docs:
            raise ValueError("No documents uploaded for this project.")

        # 2. Extract full text from documents
        await publish(redis, channel, {"type": "progress", "message": "Extracting document text..."})
        
        text_by_doc = {}
        # Try chunked text first
        if chunks:
            for content, _, filename in chunks:
                if filename not in text_by_doc:
                    text_by_doc[filename] = []
                text_by_doc[filename].append(content)
        
        # For any document that doesn't have chunks, download and parse
        for doc_id, filename, s3_key, mime_type, doc_type, src_url in docs:
            if filename not in text_by_doc:
                await publish(redis, channel, {"type": "progress", "message": f"Parsing document {filename}..."})
                try:
                    if doc_type == "url" and src_url:
                        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                            response = await client.get(src_url, headers={"User-Agent": "Mozilla/5.0"})
                            response.raise_for_status()
                        soup = BeautifulSoup(response.text, "lxml")
                        for tag in soup(["script", "style", "nav", "footer", "header"]):
                            tag.decompose()
                        text = soup.get_text(separator="\n", strip=True)
                    else:
                        if not s3_key:
                            raise ValueError(f"No S3 key or URL for document {filename}")
                        body = await s3_download(s3_key)
                        text = parse_document(body, mime_type)
                    
                    if text.strip():
                        text_by_doc[filename] = [text]
                except Exception as e:
                    logger.error(f"Failed to parse document {filename}: {e}")

        # Combine text parts
        text_parts = []
        for filename, parts in text_by_doc.items():
            text_parts.append(f"--- {filename} ---\n" + "\n".join(parts))
        
        combined_text = "\n\n".join(text_parts)
        if not combined_text.strip():
            raise ValueError("Could not extract any text from the project documents.")

        # 3. Call robust server LLM for raw line-item extraction
        await publish(redis, channel, {"type": "progress", "message": "Sending documents to AI for cost extraction..."})

        system_prompt = (
            "You are an expert cost segregation and data extraction assistant.\n"
            "Your task is to parse construction documents, invoices, or contractor bids "
            "and extract every cost line item with a description and cost amount.\n\n"
            "Respond ONLY with a valid JSON array, without any markdown formatting or surrounding text. "
            "Each element in the array must be an object with the following keys:\n"
            "- 'description': a clear description of the line item (e.g., 'HVAC Installation', 'Acoustical Ceilings')\n"
            "- 'cost': the numerical cost of the item (e.g. 45000)\n\n"
            "Do not include items with zero or missing costs. Only return the JSON array."
        )

        user_prompt = f"Extract all line items and their costs from the following text:\n\n{combined_text[:40000]}"



        raw_response = await llm.complete([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ])

        # 4. Clean and parse JSON
        await publish(redis, channel, {"type": "progress", "message": "Processing extracted items..."})
        
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```[a-z]*\n?", "", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"\n?```$", "", cleaned)
        cleaned = cleaned.strip()

        try:
            line_items = json.loads(cleaned)
            if isinstance(line_items, dict):
                for key in ["line_items", "items", "data"]:
                    if key in line_items and isinstance(line_items[key], list):
                        line_items = line_items[key]
                        break
            if not isinstance(line_items, list):
                raise ValueError("Expected a list of line items.")
        except Exception as e:
            logger.error(f"Failed to parse AI output: {cleaned}. Error: {e}")
            raise ValueError(f"Invalid JSON response from AI: {e}")

        # Validate line items structure
        valid_items = []
        for item in line_items:
            if not isinstance(item, dict):
                continue
            desc = item.get("description") or item.get("name")
            cost = item.get("cost") or item.get("amount")
            if desc and cost:
                try:
                    cost_val = float(cost)
                    if cost_val > 0:
                        valid_items.append({
                            "description": str(desc).strip(),
                            "cost": cost_val
                        })
                except (ValueError, TypeError):
                    continue

        await publish(redis, channel, {"type": "progress", "message": f"Successfully extracted {len(valid_items)} line items."})

        # 5. Keep task running with Phase 1 output; Phase 2 will produce the final output.
        output_payload = {"line_items": valid_items}
        await update_task(http, task_id, org_id, "running", output=output_payload)

        # 6. Enqueue the next job
        try:
            redis_conn = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
            await redis_conn.enqueue_job(
                "run_classification",
                task_id=task_id,
                org_id=org_id,
                project_id=project_id,
                line_items=valid_items,
            )
            await redis_conn.aclose()
            logger.info("Enqueued next job 'run_classification' successfully.")
        except Exception as enqueue_err:
            logger.error(f"Failed to enqueue classification job: {enqueue_err}", exc_info=True)
            await update_task(http, task_id, org_id, "failed", output=output_payload, error=str(enqueue_err))
            await publish(redis, channel, {"type": "error", "data": f"Failed to enqueue classification: {enqueue_err}"})
            raise

    except Exception as exc:
        logger.error(f"Extraction failed: {exc}", exc_info=True)
        try:
            await _set_project_status(db_url, org_id, project_id, "documents_uploaded")
        except Exception:
            logger.warning("Failed to reset project status after extraction failure.", exc_info=True)
        await publish(redis, channel, {"type": "error", "data": str(exc)})
        await update_task(http, task_id, org_id, "failed", error=str(exc))
        raise


async def run_classification(
    ctx: dict[str, Any],
    *,
    task_id: str,
    org_id: str,
    project_id: str,
    line_items: list[dict[str, Any]] | None = None,
) -> None:
    """Arq job: classify extracted cost line items using the JSON ruleset and an LLM."""
    redis = ctx["redis"]
    http = ctx["http"]
    channel = task_channel(org_id, task_id)
    db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    await update_task(http, task_id, org_id, "running")
    await publish(redis, channel, {"type": "progress", "message": "Starting MACRS classification..."})

    try:
        if line_items is None:
            line_items = await _load_line_items_from_task(db_url, org_id, task_id)
        line_items = _normalize_line_items(line_items or [])
        if not line_items:
            raise ValueError("No extracted line items were provided for classification.")

        await _set_project_status(db_url, org_id, project_id, "analyzing")

        # Load the active JSON ruleset (most recently uploaded)
        await publish(redis, channel, {"type": "progress", "message": "Loading classification ruleset..."})
        ruleset_context = await _load_ruleset_text(db_url)
        if ruleset_context:
            logger.info("Ruleset loaded for classification (%d bytes).", len(ruleset_context))
        else:
            logger.info("No ruleset found — using built-in MACRS taxonomy.")

        # Classify in batches of 30
        BATCH_SIZE = 30
        enriched: list[dict[str, Any]] = []
        total_batches = (len(line_items) + BATCH_SIZE - 1) // BATCH_SIZE

        for batch_num, start in enumerate(range(0, len(line_items), BATCH_SIZE), start=1):
            batch_items = line_items[start:start + BATCH_SIZE]
            await publish(
                redis,
                channel,
                {"type": "progress", "message": f"Classifying batch {batch_num} of {total_batches} ({len(batch_items)} items)..."},
            )
            batch_results = await _classify_items_batch(batch_items, ruleset_context)
            enriched.extend(batch_results)

        await publish(redis, channel, {"type": "progress", "message": "Saving classified line items..."})
        await _save_workflow_items(db_url, org_id, project_id, enriched)
        await _set_project_status(db_url, org_id, project_id, "analysis_complete")

        await publish(redis, channel, {"type": "progress", "message": "Classification complete. Ready for user review."})
        await publish(redis, channel, {"type": "done"})

    except Exception as exc:
        logger.error(f"Classification failed: {exc}", exc_info=True)
        try:
            await _set_project_status(db_url, org_id, project_id, "documents_uploaded")
        except Exception:
            logger.warning("Failed to reset project status after classification failure.", exc_info=True)
        await publish(redis, channel, {"type": "error", "data": str(exc)})
        await update_task(http, task_id, org_id, "failed", error=str(exc))
        raise


async def _load_line_items_from_task(db_url: str, org_id: str, task_id: str) -> list[dict[str, Any]]:
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            cur = await conn.execute(
                "SELECT output, input FROM agent_tasks WHERE id = %s::uuid",
                [task_id],
            )
            row = await cur.fetchone()
    if not row:
        return []
    output, input_payload = row
    for payload in (output, input_payload):
        if isinstance(payload, dict):
            items = payload.get("line_items") or payload.get("items")
            if isinstance(items, list):
                return items
    return []


def _normalize_line_items(line_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for raw in line_items:
        if not isinstance(raw, dict):
            continue
        description = raw.get("description") or raw.get("name")
        cost = raw.get("cost") if raw.get("cost") is not None else raw.get("amount")
        if not description or cost is None:
            continue
        try:
            amount = float(cost)
        except (TypeError, ValueError):
            continue
        if amount <= 0:
            continue
        normalized.append({"description": str(description).strip(), "cost": amount})
    return normalized


async def _load_ruleset_text(db_url: str) -> str | None:
    """Return the raw text of the most recently uploaded ruleset, or None if absent."""
    from app.s3 import download as s3_download
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            cur = await conn.execute(
                "SELECT s3_key FROM cost_seg_rulesets WHERE status = 'ready' AND workflow_type = 'cost_seg' ORDER BY created_at DESC LIMIT 1"
            )
            row = await cur.fetchone()
    if not row or not row[0]:
        return None
    try:
        body = await s3_download(row[0])
        return body.decode("utf-8", errors="replace")
    except Exception as exc:
        logger.warning("Failed to load ruleset file: %s", exc)
        return None


async def _classify_items_batch(
    items: list[dict[str, Any]],
    ruleset_context: str | None,
) -> list[dict[str, Any]]:
    """Classify a batch of items (up to 30) in a single LLM call."""
    items_text = "\n".join(
        f"ITEM {i}: {json.dumps(item)}" for i, item in enumerate(items)
    )

    ruleset_block = (
        f"\n\nCLASSIFICATION RULESET:\n{ruleset_context}"
        if ruleset_context
        else "\n\nNo custom ruleset uploaded — apply standard IRS GDS MACRS guidelines."
    )

    system_prompt = (
        "You are an expert tax and cost segregation classification agent.\n"
        "Classify each construction cost line item according to IRS GDS MACRS rules.\n"
        "Use the CLASSIFICATION RULESET provided when available; otherwise apply standard MACRS."
        + ruleset_block
        + "\n\nRespond ONLY with a valid JSON array (no markdown, no extra text). "
        f"The array MUST contain EXACTLY {len(items)} elements in input order. "
        "Each element must have:\n"
        "- 'description': original or clarified item description\n"
        "- 'class': asset class name (e.g. 'Asset Class 00.12', 'Land Improvements')\n"
        "- 'recovery_period': integer years (5/7/15/39) or null if non-depreciable\n"
        "- 'category_id': one of: land | personal_property_5yr | personal_property_7yr | "
        "land_improvements_15yr | qualified_improvement_property_15yr | building_39yr | needs_review | excluded\n"
        "- 'category_label': friendly label\n"
        "- 'bonus_eligible': boolean (true if recovery_period <= 20)\n"
        "- 'year1_deduction': first-year deduction amount. "
        "2026: bonus=20%. Rates: 5yr=20%, 7yr=14.29%, 15yr-land=5%, 15yr-QIP=3.33%, 39yr=2.56%. "
        "Bonus: (cost*0.20)+(cost*0.80*rate). No bonus: cost*rate\n"
        "- 'confidence': float 0.0–1.0\n"
        "- 'notes': concise rationale referencing ruleset or IRS sections"
    )

    raw_response = await llm.complete([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Classify these {len(items)} line items:\n\n{items_text}"},
    ])

    parsed = _clean_json(raw_response)
    if not isinstance(parsed, list) or len(parsed) != len(items):
        raise ValueError(
            f"Expected JSON array of {len(items)} items from LLM, "
            f"got {type(parsed).__name__} with "
            f"{len(parsed) if isinstance(parsed, list) else 'N/A'} elements."
        )

    results = []
    for item, classification in zip(items, parsed):
        cost = float(item["cost"])

        recovery_period_val = classification.get("recovery_period")
        try:
            recovery_period = int(recovery_period_val) if recovery_period_val is not None else None
        except (ValueError, TypeError):
            recovery_period = None

        category_id = str(classification.get("category_id") or "needs_review").strip()
        category_label = str(classification.get("category_label") or classification.get("class") or "Needs Review").strip()
        bonus_eligible = bool(classification.get("bonus_eligible", False))

        year1_val = classification.get("year1_deduction")
        try:
            year1_deduction = float(year1_val) if year1_val is not None else None
        except (ValueError, TypeError):
            year1_deduction = None

        confidence = _coerce_confidence(classification.get("confidence"))
        notes = str(classification.get("notes") or "").strip() or "Classified per MACRS guidelines."

        results.append({
            "description": str(classification.get("description") or item["description"]).strip(),
            "cost": cost,
            "class": str(classification.get("class") or category_label),
            "recovery_period": recovery_period,
            "category_id": category_id,
            "category_label": category_label,
            "bonus_eligible": bonus_eligible,
            "year1_deduction": year1_deduction,
            "confidence": confidence,
            "notes": notes,
        })

    return results


def _coerce_confidence(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, value))


async def _set_project_status(db_url: str, org_id: str, project_id: str, status: str) -> None:
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            await conn.execute(
                """
                UPDATE workflow_sessions
                SET status = %s,
                    updated_at = now()
                WHERE id = %s::uuid
                  AND org_id = %s::uuid
                  AND type = 'cost_seg'
                """,
                [status, project_id, org_id],
            )


async def _save_workflow_items(
    db_url: str,
    org_id: str,
    project_id: str,
    enriched: list[dict[str, Any]],
) -> None:
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            await conn.execute(
                """
                DELETE FROM workflow_items
                WHERE session_id = %s::uuid
                  AND type = 'line_item'
                  AND (data->>'user_edited')::boolean IS NOT TRUE
                """,
                [project_id],
            )
            for sort_order, item in enumerate(enriched):
                category_id = item.get("category_id") or "needs_review"
                amount = float(item.get("cost") or item.get("amount") or 0)
                data = {
                    "category_id": category_id,
                    "category_label": item.get("category_label") or item.get("class") or "Needs Review",
                    "recovery_period": item.get("recovery_period"),
                    "bonus_eligible": bool(item.get("bonus_eligible")),
                    "year1_deduction": item.get("year1_deduction"),
                    "confidence": item.get("confidence"),
                    "ai_notes": item.get("notes") or "",
                    "user_edited": False,
                    "irs_context": [
                        {
                            "rule_id": c.get("rule_id"),
                            "title": c.get("title"),
                            "filename": c.get("filename"),
                            "score": c.get("score"),
                        }
                        for c in (item.get("irs_context") or [])[:3]
                    ],
                }
                await conn.execute(
                    """
                    INSERT INTO workflow_items
                        (id, session_id, org_id, type, role, content, amount, data, sort_order, created_at)
                    VALUES
                        (gen_random_uuid(), %s::uuid, %s::uuid, %s, 'ai', %s, %s, %s, %s, now())
                    """,
                    [
                        project_id,
                        org_id,
                        ITEM_TYPE,
                        str(item.get("description") or "Unknown item"),
                        amount,
                        Jsonb(data),
                        sort_order,
                    ],
                )


async def run_report(
    ctx: dict[str, Any],
    *,
    task_id: str,
    org_id: str,
    project_id: str,
) -> None:
    """Arq job: calculate depreciation schedules, generate PDF, upload to S3, and insert DB document record."""
    redis = ctx["redis"]
    http = ctx["http"]
    channel = task_channel(org_id, task_id)
    db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    await update_task(http, task_id, org_id, "running")
    await publish(redis, channel, {"type": "progress", "message": "Starting report generation..."})

    try:
        # 1. Load project details
        project_details = await _load_project_details(db_url, org_id, project_id)
        
        # 2. Load workflow line items
        line_items = await _load_workflow_items(db_url, org_id, project_id)
        if not line_items:
            raise ValueError("No classified line items found to generate the report.")

        # 3. Recalculate schedules and compile summary
        await publish(redis, channel, {"type": "progress", "message": "Calculating depreciation schedules..."})
        
        property_meta = project_details.get("meta", {}).get("property") or {}
        basis = property_meta.get("total_cost") or sum(item["cost"] for item in line_items)
        
        GDS_RATES = {
            5: [0.2000, 0.3200, 0.1920, 0.1152, 0.1152, 0.0576],
            7: [0.1429, 0.2449, 0.1749, 0.1249, 0.0893, 0.0892, 0.0893, 0.0446],
            15: [0.0500, 0.0950, 0.0855, 0.0770, 0.0693, 0.0623, 0.0590, 0.0590, 0.0591, 0.0590, 0.0591, 0.0590, 0.0591, 0.0590, 0.0591, 0.0295],
            39: [0.02564] * 39
        }
        
        processed_items = []
        total_seg = 0.0
        total_year1 = 0.0
        
        for item in line_items:
            cost = float(item["cost"])
            category_id = item["category_id"]
            rp = item["recovery_period"]
            bonus_eligible = bool(item["bonus_eligible"])
            
            rates = []
            if category_id == "qualified_improvement_property_15yr":
                rates = [0.0333] + [0.0667] * 14 + [0.0333]
            elif rp in GDS_RATES:
                rates = GDS_RATES[rp]
            elif rp and rp > 0:
                rates = [1.0 / rp] * int(rp)
                
            bonus_amount = cost * 0.20 if bonus_eligible else 0.0
            depreciable_basis = cost - bonus_amount
            y1_rate = rates[0] if rates else 0.0
            y1_deduction = bonus_amount + depreciable_basis * y1_rate
            
            schedules = []
            for year_idx, rate in enumerate(rates, start=1):
                dep_amount = depreciable_basis * rate
                if year_idx == 1:
                    dep_amount += bonus_amount
                schedules.append({
                    "year": year_idx,
                    "rate": rate,
                    "amount": round(dep_amount, 2)
                })
                
            total_seg += cost
            total_year1 += y1_deduction
            
            processed_items.append({
                "description": item["description"],
                "category_id": category_id,
                "category_label": item["category_label"],
                "cost": cost,
                "recovery_period": rp,
                "bonus_eligible": bonus_eligible,
                "year1_deduction": round(y1_deduction, 2),
                "schedules": schedules,
            })
            
        summary = {
            "total_cost": total_seg,
            "total_year1": round(total_year1, 2),
        }

        # 4. Generate report — try Claude Skills API first, fallback to PDFGenerator
        pdf_bytes = None
        study_date_str = project_details.get("meta", {}).get("study_date") or datetime.date.today().isoformat()

        if settings.ANTHROPIC_API_KEY and settings.CLAUDE_SKILLS_COST_SEG_ID:
            try:
                await publish(redis, channel, {"type": "progress", "message": "Generating report with AI Skills..."})
                from app.integrations.claude_skills import ClaudeSkillsClient

                skills_client = ClaudeSkillsClient(
                    api_key=settings.ANTHROPIC_API_KEY,
                    skill_id=settings.CLAUDE_SKILLS_COST_SEG_ID,
                    skill_version=settings.CLAUDE_SKILLS_COST_SEG_VERSION,
                    model=settings.CLAUDE_SKILLS_MODEL,
                    base_url=settings.ANTHROPIC_BASE_URL,
                    workspace_id=settings.ANTHROPIC_WORKSPACE_ID,
                )

                # Prepare data payload for Skills API
                # Strip `schedules` from each line item — they're not used in the
                # report template and massively inflate the payload size.
                skills_line_items = [
                    {k: v for k, v in item.items() if k != "schedules"}
                    for item in processed_items
                ]
                skills_data = {
                    "project_name": project_details["name"],
                    "study_date": study_date_str,
                    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "property": property_meta,
                    "line_items": skills_line_items,
                    "bonus_rate": 0.20,
                    "summary": summary,
                }
                result = await skills_client.generate_report(skills_data)
                html_content = result["html"]
                await publish(redis, channel, {"type": "progress", "message": "✅ Claude AI successfully generated custom report layout."})

                # Persist the HTML report to workflow_outputs so the server
                # preview endpoint can serve it immediately (no second Claude call).
                await _upsert_html_report(
                    db_url=db_url,
                    org_id=org_id,
                    project_id=project_id,
                    html_content=html_content,
                    totals=summary,
                )

                # Convert HTML to PDF
                await publish(redis, channel, {"type": "progress", "message": "Converting AI report to PDF..."})
                try:
                    import weasyprint
                    pdf_bytes = weasyprint.HTML(string=html_content).write_pdf()
                except ImportError:
                    logger.info("weasyprint not available, falling back to PDFGenerator")
                    await publish(redis, channel, {"type": "progress", "message": "⚠️ Weasyprint missing, falling back to standard generator."})
                    pdf_bytes = None
                except Exception as html_to_pdf_err:
                    logger.warning(f"HTML-to-PDF conversion failed: {html_to_pdf_err}")
                    await publish(redis, channel, {"type": "progress", "message": "⚠️ HTML conversion failed, falling back to standard generator."})
                    pdf_bytes = None

            except Exception as skills_err:
                logger.warning(f"Claude Skills report generation failed, falling back to PDFGenerator: {skills_err}")
                await publish(redis, channel, {"type": "progress", "message": "⚠️ Claude AI generation failed, falling back to standard generator."})
                pdf_bytes = None

        if pdf_bytes is None:
            # Fallback: use the existing ReportLab PDFGenerator
            await publish(redis, channel, {"type": "progress", "message": "Compiling standard PDF document..."})
            pdf_gen = PDFGenerator()
            pdf_bytes = pdf_gen.generate_report(
                project_name=project_details["name"],
                study_date=study_date_str,
                property_details=property_meta,
                line_items=processed_items,
                summary=summary,
            )

        # 5. Upload the generated PDF to S3
        await publish(redis, channel, {"type": "progress", "message": "Uploading report to storage..."})
        s3_key = f"{org_id}/{task_id}_cost_seg.pdf"
        await s3_upload(s3_key, pdf_bytes)

        # 6. Insert Document record in DB
        await publish(redis, channel, {"type": "progress", "message": "Saving document record..."})
        doc_id = await _insert_document_record(
            db_url=db_url,
            org_id=org_id,
            project_id=project_id,
            s3_key=s3_key,
            filename=f"{project_details['name'].replace(' ', '_')}_cost_seg_report.pdf",
            size_bytes=len(pdf_bytes),
        )

        # 7. Update project status to report_ready
        await _set_project_status(db_url, org_id, project_id, "report_ready")

        output_payload = {
            "document_id": doc_id,
            "s3_key": s3_key,
            "summary": summary,
        }
        await update_task(http, task_id, org_id, "succeeded", output=output_payload)
        await publish(redis, channel, {"type": "progress", "message": "Report generation complete."})
        await publish(redis, channel, {"type": "done"})
        logger.info("Cost segregation report generation complete.", extra={"task_id": task_id, "document_id": doc_id})

    except Exception as exc:
        logger.error(f"Report generation failed: {exc}", exc_info=True)
        try:
            await _set_project_status(db_url, org_id, project_id, "documents_uploaded")
        except Exception:
            logger.warning("Failed to reset project status after report failure.", exc_info=True)
        await publish(redis, channel, {"type": "error", "data": str(exc)})
        await update_task(http, task_id, org_id, "failed", error=str(exc))
        raise


async def _load_project_details(db_url: str, org_id: str, project_id: str) -> dict[str, Any]:
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            cur = await conn.execute(
                """
                SELECT title, meta
                FROM workflow_sessions
                WHERE id = %s::uuid
                  AND org_id = %s::uuid
                  AND type = 'cost_seg'
                """,
                [project_id, org_id],
            )
            row = await cur.fetchone()
    if not row:
        return {"name": "Cost Segregation Project", "meta": {}}
    return {"name": row[0], "meta": row[1] or {}}


async def _load_workflow_items(db_url: str, org_id: str, project_id: str) -> list[dict[str, Any]]:
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            cur = await conn.execute(
                """
                SELECT content, amount, data
                FROM workflow_items
                WHERE session_id = %s::uuid
                  AND type = 'line_item'
                ORDER BY sort_order ASC
                """,
                [project_id],
            )
            rows = await cur.fetchall()
    items = []
    for row in rows:
        content, amount, data = row
        d = data or {}
        items.append({
            "description": content,
            "cost": float(amount or 0),
            "category_id": d.get("category_id") or "needs_review",
            "category_label": d.get("category_label") or "Needs Review",
            "recovery_period": d.get("recovery_period"),
            "bonus_eligible": bool(d.get("bonus_eligible")),
            "year1_deduction": d.get("year1_deduction"),
        })
    return items


async def _insert_document_record(
    db_url: str,
    org_id: str,
    project_id: str,
    s3_key: str,
    filename: str,
    size_bytes: int,
) -> str:
    doc_id = str(uuid.uuid4())
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            await conn.execute(
                """
                INSERT INTO documents (
                    id, org_id, s3_key, document_type, filename, mime_type, size_bytes, status, session_id, created_at
                )
                VALUES (
                    %s::uuid, %s::uuid, %s, 'file', %s, 'application/pdf', %s, 'ready', %s::uuid, now()
                )
                """,
                [doc_id, org_id, s3_key, filename, size_bytes, project_id],
            )
    return doc_id


async def _upsert_html_report(
    db_url: str,
    org_id: str,
    project_id: str,
    html_content: str,
    totals: dict[str, Any],
) -> None:
    """Save or update the HTML report in workflow_outputs so the server can serve it."""
    import json as _json

    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.current_org_id', %s, true)", [str(org_id)])
            await conn.execute(
                """
                INSERT INTO workflow_outputs (
                    id, session_id, org_id, type, content, data, generated_at
                )
                VALUES (
                    %s::uuid, %s::uuid, %s::uuid, 'html_report', %s, %s::jsonb, now()
                )
                ON CONFLICT (session_id, type)
                DO UPDATE SET content = EXCLUDED.content,
                             data = EXCLUDED.data,
                             generated_at = EXCLUDED.generated_at
                """,
                [str(uuid.uuid4()), project_id, org_id, html_content, _json.dumps(totals)],
            )
