import asyncio
import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import UUID


import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import db_session, get_db
from app.core.logging import get_logger
from app.core.rbac import authorize
from app.core.tenancy import RequestContext
from app.integrations.s3 import delete as s3_delete, make_s3_key, presigned_get, upload
from app.models.document import Document, DocumentChunk, DocumentStatus
from app.services.audit import log_action
from app.services.documents import (
    create_document,
    create_url_document,
    delete_document,
    get_document,
    list_documents,
)
from app.services.ingestion import chunk_text, parse_document
from app.integrations.embeddings import embed_batch
from app.integrations.llm import generate_document_metadata

router = APIRouter(prefix="/api/documents", tags=["documents"])
logger = get_logger(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


class DocumentResponse(BaseModel):
    id: str
    filename: str
    mime_type: str | None
    file_size: int | None
    status: str
    s3_key: str | None
    source_url: str | None = None
    document_type: str = "file"
    upload_source: str = "file"
    created_at: str
    updated_at: str | None = None
    download_url: str | None = None
    extracted_title: str | None = None
    summary: str | None = None
    keywords: list[str] | None = None
    tags: dict | None = None
    description: str | None = None


def _doc_to_response(doc: Document, download_url: str | None = None) -> dict:
    kw = doc.keywords
    if isinstance(kw, str):
        try:
            kw = json.loads(kw)
        except Exception:
            kw = None
    tags = doc.tags or {}
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except Exception:
            tags = {}
    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "mime_type": doc.mime_type,
        "file_size": doc.size_bytes,
        "status": doc.status,
        "s3_key": doc.s3_key,
        "source_url": doc.source_url,
        "document_type": doc.document_type,
        "upload_source": doc.document_type,
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        "download_url": download_url,
        "extracted_title": doc.extracted_title,
        "summary": doc.summary,
        "keywords": kw if isinstance(kw, list) else None,
        "tags": tags,
        "description": doc.description,
    }


async def _ingest_document_bg(
    document_id: UUID,
    org_id: UUID,
    body: bytes | None,
    mime_type: str | None,
    filename: str = "document",
    source_url: str | None = None,
    web_url_id: UUID | None = None,
) -> None:
    """
    Background ingestion: parse → chunk → embed → generate metadata → insert chunks → mark ready.
    Supports both file bytes (body) and web URLs (source_url).
    Runs after the upload transaction has committed, so all DB writes are fresh sessions.
    """
    async def _set_status(s: str) -> None:
        try:
            async with db_session(org_id) as sess:
                await sess.execute(
                    sa_text(
                        "UPDATE documents SET status = :s, updated_at = :ts WHERE id = CAST(:id AS uuid)"
                    ),
                    {"s": s, "id": str(document_id), "ts": datetime.now(timezone.utc)},
                )
        except Exception as e:
            logger.error("Failed to update document status", doc_id=str(document_id), error=str(e))

    async def _set_web_url_status(s: str) -> None:
        if not web_url_id:
            return
        try:
            async with db_session(org_id) as sess:
                await sess.execute(
                    sa_text("UPDATE web_urls SET status = :s WHERE id = CAST(:id AS uuid)"),
                    {"s": s, "id": str(web_url_id)},
                )
        except Exception as e:
            logger.error("Failed to update web url status", web_url_id=str(web_url_id), error=str(e))

    try:
        scraped_size = None
        # ── Resolve text from either a web URL or raw file bytes ───────────────
        if source_url:
            logger.info("Fetching URL for ingestion", doc_id=str(document_id), url=source_url)
            async with httpx.AsyncClient(follow_redirects=True, timeout=120.0) as client:
                response = await client.get(source_url, headers={"User-Agent": "Mozilla/5.0"})
                response.raise_for_status()
            content_type = response.headers.get("Content-Type", "").lower()
            if not content_type or "text/html" in content_type or "text/xml" in content_type:
                soup = BeautifulSoup(response.text, "lxml")
                for tag in soup(["script", "style", "nav", "footer", "header"]):
                    tag.decompose()
                text = soup.get_text(separator="\n", strip=True)
                scraped_size = len(text.encode("utf-8"))
            else:
                mime = content_type.split(";")[0].strip()
                # parse_document (pypdf) is CPU-bound/sync — run in thread pool
                # so it doesn't block the async event loop for large PDFs.
                raw_content = response.content
                text = await asyncio.to_thread(parse_document, raw_content, mime)
                scraped_size = len(raw_content)
        else:
            raw_body = body or b""
            text = await asyncio.to_thread(parse_document, raw_body, mime_type)

        if not text.strip():
            logger.warning("Document produced no text", doc_id=str(document_id))
            await _set_status(DocumentStatus.FAILED.value)
            await _set_web_url_status("failed")
            return

        # chunk_text is also sync — offload it too (for very large documents)
        chunks = await asyncio.to_thread(chunk_text, text)
        logger.info("Chunked document for ingestion", doc_id=str(document_id), chunk_count=len(chunks))

        embeddings, metadata = await _run_parallel(
            embed_batch(chunks),
            generate_document_metadata(text, filename),
        )

        now = datetime.now(timezone.utc)
        async with db_session(org_id) as sess:
            for i, (content, embedding) in enumerate(zip(chunks, embeddings)):
                sess.add(DocumentChunk(
                    org_id=org_id,
                    document_id=document_id,
                    chunk_index=i,
                    content=content,
                    embedding=embedding,
                ))
            await sess.flush()
            update_query = (
                "UPDATE documents SET status = :s, updated_at = :ts, extracted_title = :title, "
                "summary = :summary, keywords = CAST(:keywords AS json) "
            )
            update_params = {
                "s": DocumentStatus.READY.value,
                "ts": now,
                "id": str(document_id),
                "title": metadata.get("title") or None,
                "summary": metadata.get("summary") or None,
                "keywords": json.dumps(metadata.get("keywords") or []),
            }
            if scraped_size is not None:
                update_query += ", size_bytes = :size "
                update_params["size"] = scraped_size

            update_query += "WHERE id = CAST(:id AS uuid)"
            await sess.execute(sa_text(update_query), update_params)

        await _set_web_url_status("ready")
        logger.info("Ingestion complete", doc_id=str(document_id), chunks=len(chunks))

    except Exception as e:
        logger.error("Background ingestion failed", doc_id=str(document_id), error=str(e))
        await _set_status(DocumentStatus.FAILED.value)
        await _set_web_url_status("failed")


async def _run_parallel(*coros):
    import asyncio
    return await asyncio.gather(*coros)


@router.get("", response_model=list[DocumentResponse])
async def list_docs(
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    docs = await list_documents(session, ctx.org_id)
    return [_doc_to_response(d) for d in docs if d.document_type == "file"]


class UpdateDocumentRequest(BaseModel):
    doc_type: str = ""
    access_roles: list[str] = []
    description: str | None = None
    is_confidential: bool = False


@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_doc_metadata(
    doc_id: UUID,
    body: UpdateDocumentRequest,
    ctx: RequestContext = authorize("documents:upload"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    doc = await get_document(session, doc_id)
    existing = doc.tags or {}
    doc.tags = {
        **existing,
        "doc-type": body.doc_type.strip(),
        "roles": body.access_roles,
        "confidential": "true" if body.is_confidential else "false",
    }
    doc.description = body.description
    doc.updated_at = datetime.now(timezone.utc)
    session.add(doc)
    await session.flush()
    await log_action(session, ctx, "document.update", "document", str(doc_id))
    return _doc_to_response(doc)


@router.post("", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    doc_type: str = Form(""),
    access_roles: str = Form(""),   # comma-separated list of role names
    description: str = Form(""),
    is_confidential: str = Form("false"),
    ctx: RequestContext = authorize("documents:upload"),
) -> Any:
    """
    Upload a document (<50MB) with metadata. Commits the document record first,
    then runs ingestion as a background task so the FK constraint is satisfied.
    """
    body = await file.read()

    if len(body) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Maximum size is 50MB.",
        )

    filename = file.filename or "upload"
    mime_type = file.content_type
    size_bytes = len(body)
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "bin"

    roles_list = [r.strip() for r in access_roles.split(",") if r.strip()]
    
    # Intercept IRS rule document types
    if doc_type.strip().lower() in ("irs_rule", "irs_rules"):
        if ctx.role != "super_admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only super admins can upload IRS rules.",
            )

        from app.models.irs_rule import IrsRule
        from app.core.config import settings
        from arq.connections import RedisSettings, create_pool

        async with db_session(ctx.org_id) as session:
            rule = IrsRule(
                filename=filename,
                title=filename.rsplit(".", 1)[0],
                size_bytes=size_bytes,
                status="processing",
            )
            session.add(rule)
            await session.flush()

            s3_key = f"global/irs-rules/{rule.id}.{ext}"
            rule.s3_key = s3_key
            session.add(rule)
            await session.flush()
            
            rule_id = rule.id
            rule_snapshot = {
                "id": str(rule.id),
                "filename": rule.filename,
                "mime_type": "application/pdf",
                "file_size": rule.size_bytes,
                "status": rule.status,
                "s3_key": rule.s3_key,
                "source_url": None,
                "document_type": "file",
                "upload_source": "file",
                "created_at": rule.created_at.isoformat(),
                "updated_at": None,
                "download_url": None,
                "extracted_title": rule.title,
                "summary": None,
                "keywords": None,
                "tags": {"doc-type": doc_type.strip()},
                "description": None,
            }

        await upload(s3_key, body)

        # Enqueue the background task for ingest_irs_rule
        arq = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        await arq.enqueue_job("ingest_irs_rule", irs_rule_id=str(rule_id))
        await arq.aclose()

        return {"task_id": None, "document": rule_snapshot}
    tags: dict = {
        "roles": roles_list,
        "doc-type": doc_type.strip(),
        "confidential": "true" if is_confidential.lower() == "true" else "false",
        "user-id": str(ctx.user_id),
    }

    async with db_session(ctx.org_id) as session:
        doc = await create_document(
            session,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            filename=filename,
            s3_key="",
            mime_type=mime_type,
            size_bytes=size_bytes,
            tags=tags,
            description=description.strip() or None,
        )
        s3_key = make_s3_key(str(ctx.org_id), str(doc.id), ext)
        doc.s3_key = s3_key
        session.add(doc)
        await session.flush()
        doc_id = doc.id
        doc_snapshot = _doc_to_response(doc)
        await log_action(session, ctx, "document.upload", "document", str(doc_id), {"filename": filename})

    await upload(s3_key, body, tags={"org_id": str(ctx.org_id), "document_id": str(doc_id)})

    background_tasks.add_task(_ingest_document_bg, doc_id, ctx.org_id, body, mime_type, filename)

    return {"task_id": None, "document": doc_snapshot}


class IngestUrlRequest(BaseModel):
    url: str


@router.post("/url", status_code=202)
async def ingest_url(
    payload: IngestUrlRequest,
    background_tasks: BackgroundTasks,
    ctx: RequestContext = authorize("documents:upload"),
) -> Any:
    """
    Submit a public web URL for ingestion.
    """
    parsed = urlparse(payload.url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only http:// and https:// URLs are supported.",
        )

    async with db_session(ctx.org_id) as session:
        doc = await create_url_document(
            session,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            source_url=payload.url,
        )
        doc_id = doc.id
        doc_snapshot = _doc_to_response(doc)
        await log_action(
            session, ctx, "document.url_ingest", "document", str(doc_id), {"url": payload.url}
        )

    background_tasks.add_task(
        _ingest_document_bg,
        doc_id,
        ctx.org_id,
        None,
        None,
        doc_snapshot["filename"],
        payload.url,
    )

    return {"task_id": None, "document": doc_snapshot}


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_doc(
    doc_id: UUID,
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    doc = await get_document(session, doc_id)
    if doc.s3_key:
        from app.integrations.s3 import _is_local_mode
        if _is_local_mode():
            download_url = f"/api/documents/{doc.id}/download"
        else:
            download_url = await presigned_get(doc.s3_key)
    else:
        download_url = None
    return _doc_to_response(doc, download_url)


@router.get("/{doc_id}/download")
async def download_doc_file(
    doc_id: UUID,
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
):
    from fastapi.responses import FileResponse, RedirectResponse
    from app.integrations.s3 import _is_local_mode, _local_path
    
    doc = await get_document(session, doc_id)
    if not doc or not doc.s3_key:
        raise HTTPException(status_code=404, detail="Document file not found")
        
    if _is_local_mode():
        local_path = _local_path(doc.s3_key)
        if not local_path.exists():
            raise HTTPException(status_code=404, detail=f"Local file not found at {local_path}")
        return FileResponse(
            path=str(local_path),
            filename=doc.filename,
            media_type=doc.mime_type or "application/octet-stream"
        )
    else:
        url = await presigned_get(doc.s3_key)
        return RedirectResponse(url)


@router.delete("/{doc_id}", status_code=204)
async def delete_doc(
    doc_id: UUID,
    ctx: RequestContext = authorize("documents:delete"),
    session: AsyncSession = Depends(get_db),
) -> None:
    doc = await delete_document(session, doc_id)
    if doc.s3_key:
        try:
            await s3_delete(doc.s3_key)
        except Exception as e:
            logger.warning("Failed to delete S3 object", key=doc.s3_key, error=str(e))
    await log_action(session, ctx, "document.delete", "document", str(doc_id))
