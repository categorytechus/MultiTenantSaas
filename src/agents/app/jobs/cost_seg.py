"""
Arq jobs for Cost Segregation Agent.

Phase 1: run_extraction extracts raw cost line items.
Phase 2: run_classification enriches those items with IRS/MACRS classes.
"""
from typing import Any
import json
import re
import logging
import httpx
import psycopg
from psycopg.types.json import Jsonb

# Import server's robust llm wrapper directly using path to prevent package collision
import sys
from pathlib import Path
_server_dir = str(Path(__file__).parents[3] / "server")
sys.path.insert(0, _server_dir)
_old_app = sys.modules.pop("app", None)
try:
    from app.integrations.llm import llm
finally:
    sys.modules.pop("app", None)
    if _old_app:
        sys.modules["app"] = _old_app
    if sys.path[0] == _server_dir:
        sys.path.pop(0)

from app.config import settings
from app.embeddings import embed_query
from app.redis import publish, task_channel
from app.http import update_task

logger = logging.getLogger(__name__)

ITEM_TYPE = "line_item"

# Import parse_document from ingest.py
from app.jobs.ingest import parse_document
# Import s3_download
from app.s3 import download as s3_download


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
                        from bs4 import BeautifulSoup
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
        await publish(redis, channel, {"type": "progress", "message": "Sending documents to Claude for cost extraction..."})

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
            logger.error(f"Failed to parse Claude output: {cleaned}. Error: {e}")
            raise ValueError(f"Invalid JSON response from Claude: {e}")

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
            from arq.connections import create_pool, RedisSettings
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
    """Arq job: classify extracted cost line items using IRS rule chunks and an LLM."""
    redis = ctx["redis"]
    http = ctx["http"]
    channel = task_channel(org_id, task_id)
    db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    await update_task(http, task_id, org_id, "running")
    await publish(redis, channel, {"type": "progress", "message": "Starting IRS classification..."})

    try:
        if line_items is None:
            line_items = await _load_line_items_from_task(db_url, org_id, task_id)
        line_items = _normalize_line_items(line_items or [])
        if not line_items:
            raise ValueError("No extracted line items were provided for classification.")

        await _set_project_status(db_url, org_id, project_id, "analyzing")

        import asyncio
        sem = asyncio.Semaphore(5)  # classify up to 5 items concurrently
        enriched: list[dict[str, Any]] = [None] * len(line_items)  # type: ignore[list-item]

        async def _classify_one(index: int, item: dict[str, Any]) -> None:
            async with sem:
                await publish(
                    redis,
                    channel,
                    {
                        "type": "progress",
                        "message": f"Classifying item {index} of {len(line_items)}: {item['description'][:80]}",
                    },
                )
                context = await _retrieve_irs_context(db_url, item)
                classified = await _classify_line_item(item, context)
                enriched[index - 1] = classified

        await asyncio.gather(*[
            _classify_one(i, item)
            for i, item in enumerate(line_items, start=1)
        ])

        await publish(redis, channel, {"type": "progress", "message": "Saving classified line items..."})
        await _save_workflow_items(db_url, org_id, project_id, enriched)
        await _set_project_status(db_url, org_id, project_id, "analysis_complete")

        await publish(
            redis,
            channel,
            {
                "type": "progress",
                "message": "Classification complete. Enqueueing report generation...",
            },
        )
        
        # Enqueue Phase 3: run_report
        from arq.connections import create_pool, RedisSettings
        try:
            redis_conn = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
            await redis_conn.enqueue_job(
                "run_report",
                task_id=task_id,
                org_id=org_id,
                project_id=project_id,
            )
            await redis_conn.aclose()
            logger.info("Enqueued next job 'run_report' successfully.")
        except Exception as enqueue_err:
            logger.error(f"Failed to enqueue report job: {enqueue_err}", exc_info=True)
            await update_task(http, task_id, org_id, "failed", error=str(enqueue_err))
            await publish(redis, channel, {"type": "error", "data": f"Failed to enqueue report: {enqueue_err}"})
            raise

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


async def _retrieve_irs_context(db_url: str, item: dict[str, Any], top_k: int = 5) -> list[dict[str, Any]]:
    query = f"{item['description']} cost segregation MACRS recovery period asset class"
    vector = await embed_query(query)
    async with await psycopg.AsyncConnection.connect(db_url) as conn:
        from pgvector.psycopg import register_vector_async
        await register_vector_async(conn)
        async with conn.transaction():
            cur = await conn.execute(
                """
                SELECT c.id,
                       c.irs_rule_id,
                       r.title,
                       r.filename,
                       c.content,
                       1 - (c.embedding <=> %s::vector) AS score
                FROM irs_rule_chunks c
                JOIN irs_rules r ON r.id = c.irs_rule_id
                WHERE r.status = 'ready'
                  AND c.embedding IS NOT NULL
                ORDER BY c.embedding <=> %s::vector
                LIMIT %s
                """,
                [vector, vector, top_k],
            )
            rows = await cur.fetchall()
    return [
        {
            "chunk_id": str(row[0]),
            "rule_id": str(row[1]),
            "title": row[2],
            "filename": row[3],
            "content": row[4],
            "score": float(row[5]) if row[5] is not None else None,
        }
        for row in rows
    ]


async def _classify_line_item(item: dict[str, Any], context: list[dict[str, Any]]) -> dict[str, Any]:
    context_text = "\n\n---\n\n".join(
        f"Source: {c.get('title') or c.get('filename')}\nSimilarity: {c.get('score')}\n{c.get('content')}"
        for c in context
    ) or "No IRS rule chunks were retrieved. Determine classification using general GDS MACRS guidelines."

    system_prompt = (
        "You are an expert tax and cost segregation classification agent.\n"
        "Your task is to classify a single construction cost line item by comparing it "
        "against the retrieved IRS MACRS guideline chunks (IRS context).\n\n"
        "Analyze the provided IRS context carefully. Extract the appropriate asset class, recovery period, "
        "and GDS category based on the matches. If no specific match is found, apply general GDS guidelines.\n\n"
        "Respond ONLY with a valid JSON object (no markdown, no surrounding text) containing these keys:\n"
        "- 'description': the original or a slightly clarified description of the item.\n"
        "- 'class': the dynamic asset class name or classification determined from the rules (e.g. 'Asset Class 00.12 - Information Systems', 'Land Improvements', or 'Section 1250 Building').\n"
        "- 'recovery_period': the GDS recovery period in years as an integer (e.g., 5, 7, 15, 39) or null if non-depreciable.\n"
        "- 'category_id': the standard category ID identifier string. Choose from:\n"
        "  * 'land' (for non-depreciable land or related costs)\n"
        "  * 'personal_property_5yr' (for 5-year personal property)\n"
        "  * 'personal_property_7yr' (for 7-year personal property)\n"
        "  * 'land_improvements_15yr' (for 15-year land improvements)\n"
        "  * 'qualified_improvement_property_15yr' (for 15-year QIP)\n"
        "  * 'building_39yr' (for 39-year building structural components)\n"
        "  * 'needs_review' (if ambiguous or low confidence)\n"
        "  * 'excluded' (if non-depreciable or non-capital)\n"
        "- 'category_label': a friendly label for the category (e.g., 'Building - Section 1250 (39-year)').\n"
        "- 'bonus_eligible': boolean (true/false) indicating if it is eligible for bonus depreciation (typically true for GDS recovery periods <= 20 years).\n"
        "- 'year1_deduction': calculated first-year depreciation deduction amount (number) for this cost item. "
        "Under 2026 GDS MACRS Rules: bonus depreciation is 20%. The remainder uses standard GDS rates (5-yr = 20%, 7-yr = 14.29%, 15-yr Land = 5%, 15-yr QIP = 3.33%, 39-yr Building = 2.56%). If bonus eligible: year1 = (cost * 0.20) + (cost * 0.80 * standard_rate). If not bonus eligible: year1 = cost * standard_rate.\n"
        "- 'confidence': float between 0.0 and 1.0 representing your confidence in this match.\n"
        "- 'notes': concise rationale citing the specific sections of the matched IRS rules/ruling text from the context that support your classification."
    )



    raw_response = await llm.complete([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Line item:\n{json.dumps(item)}\n\nRetrieved IRS context:\n{context_text}"},
    ])
    parsed = _clean_json(raw_response)
    if not isinstance(parsed, dict):
        raise ValueError(f"Expected classification object, got {type(parsed).__name__}")

    cost = float(item["cost"])
    recovery_period_val = parsed.get("recovery_period")
    if recovery_period_val is not None:
        try:
            recovery_period = int(recovery_period_val)
        except (ValueError, TypeError):
            recovery_period = None
    else:
        recovery_period = None

    category_id = str(parsed.get("category_id") or "needs_review").strip()
    category_label = str(parsed.get("category_label") or parsed.get("class") or "Needs Review").strip()
    bonus_eligible = bool(parsed.get("bonus_eligible", False))
    
    # Calculate or parse Year 1 deduction from LLM response safely
    year1_val = parsed.get("year1_deduction")
    if year1_val is not None:
        try:
            year1_deduction = float(year1_val)
        except (ValueError, TypeError):
            year1_deduction = None
    else:
        year1_deduction = None

    confidence = _coerce_confidence(parsed.get("confidence"))
    notes = str(parsed.get("notes") or "").strip()
    if not notes:
        notes = "Classified based on similarity matched IRS rule context."

    return {
        "description": str(parsed.get("description") or item["description"]).strip(),
        "cost": cost,
        "class": str(parsed.get("class") or category_label),
        "recovery_period": recovery_period,
        "category_id": category_id,
        "category_label": category_label,
        "bonus_eligible": bonus_eligible,
        "year1_deduction": year1_deduction,
        "confidence": confidence,
        "notes": notes,
        "irs_context": context[:3],
    }


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
    import datetime
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

        # 4. Generate PDF Report using PDFGenerator
        await publish(redis, channel, {"type": "progress", "message": "Compiling PDF document..."})
        from app.jobs.pdf_gen import PDFGenerator
        pdf_gen = PDFGenerator()
        study_date_str = project_details.get("meta", {}).get("study_date") or datetime.date.today().isoformat()
        
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
        from app.s3 import upload as s3_upload
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
    import uuid
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
