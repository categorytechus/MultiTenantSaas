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
from app.models.document import Document, DocumentChunk, DocumentImage, DocumentStatus
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
    image_count: int = 0
    org_id: str | None = None


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
        "image_count": getattr(doc, "image_count", 0) or 0,
        "org_id": str(doc.org_id) if hasattr(doc, "org_id") and doc.org_id else None,
    }


async def _ingest_document_bg(
    document_id: UUID,
    org_id: UUID,
    body: bytes | None,
    mime_type: str | None,
    filename: str = "document",
    source_url: str | None = None,
    web_url_id: UUID | None = None,
    extract_images: bool = False,
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
            will_extract_images = bool(extract_images and body and mime_type == "application/pdf")
            update_params = {
                "s": DocumentStatus.PROCESSING.value if will_extract_images else DocumentStatus.READY.value,
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

        if not will_extract_images:
            await _set_web_url_status("ready")
            logger.info("Ingestion complete", doc_id=str(document_id), chunks=len(chunks))

        # ── Image extraction (PDF only, when requested) ────────────────────────
        if will_extract_images:
            await _ingest_images_bg(document_id, org_id, body, filename)
            await _set_status(DocumentStatus.READY.value)
            await _set_web_url_status("ready")
            logger.info("Ingestion and image extraction complete", doc_id=str(document_id), chunks=len(chunks))

    except Exception as e:
        logger.error("Background ingestion failed", doc_id=str(document_id), error=str(e))
        await _set_status(DocumentStatus.FAILED.value)
        await _set_web_url_status("failed")


async def _run_parallel(*coros):
    import asyncio
    return await asyncio.gather(*coros)


async def _ingest_images_bg(
    document_id: UUID,
    org_id: UUID,
    body: bytes,
    filename: str,
) -> None:
    """
    Extract, caption, upload, and index images from a PDF.
    Runs after text ingestion completes so the document is already 'ready'.
    """
    from app.services.image_extraction import caption_images_batch, extract_images_from_pdf

    logger.info("Starting image extraction", doc_id=str(document_id))
    try:
        # 1. Extract candidate images (heuristic-scored, deduped, size-filtered)
        raw_images = await asyncio.to_thread(extract_images_from_pdf, body)
        if not raw_images:
            logger.info("No extractable images found", doc_id=str(document_id))
            return

        # 2. Batch caption all candidates in a single LLM call
        captioned = await asyncio.to_thread(caption_images_batch, raw_images)
        if not captioned:
            logger.info("Captioning returned no results", doc_id=str(document_id))
            return

        # 3. Upload each image to S3 + embed caption + insert DB rows
        from app.integrations.embeddings import embed_batch
        captions_text = [c.model_caption or c.image.pdf_caption or "" for c in captioned]
        embeddings = await embed_batch(captions_text)

        now = datetime.now(timezone.utc)
        image_count = 0

        async with db_session(org_id) as sess:
            for i, (captioned_img, embedding) in enumerate(zip(captioned, embeddings)):
                img = captioned_img.image
                caption_text = captioned_img.model_caption or img.pdf_caption or ""

                # Build combined chunk content for embedding
                combined = f"{caption_text}"
                if img.pdf_caption and img.pdf_caption != captioned_img.model_caption:
                    combined = f"{img.pdf_caption}\n{caption_text}"

                # Upload to S3
                ext = img.format.lower().replace("jpeg", "jpg")
                img_s3_key = f"orgs/{org_id}/documents/{document_id}/images/{img.page}_{img.image_index}.{ext}"
                try:
                    await upload(
                        img_s3_key,
                        img.image_bytes,
                        tags={"org_id": str(org_id), "document_id": str(document_id)},
                    )
                except Exception as e:
                    logger.warning("Failed to upload image to S3", key=img_s3_key, error=str(e))
                    continue

                # Insert document_images row
                doc_image = DocumentImage(
                    org_id=org_id,
                    document_id=document_id,
                    s3_key=img_s3_key,
                    page_number=img.page,
                    image_index=img.image_index,
                    width=img.width,
                    height=img.height,
                    format=img.format.lower(),
                    pdf_caption=img.pdf_caption or None,
                    model_caption=captioned_img.model_caption or None,
                    priority_score=img.priority_score,
                    content_hash=img.content_hash,  # Store SHA-256 hash for deduplication
                    created_at=now,
                )
                sess.add(doc_image)
                await sess.flush()  # get doc_image.id

                # Insert image chunk for RAG
                sess.add(DocumentChunk(
                    org_id=org_id,
                    document_id=document_id,
                    chunk_index=10000 + i,  # offset to not collide with text chunks
                    content=combined,
                    embedding=embedding,
                    chunk_type="image",
                    image_id=doc_image.id,
                    created_at=now,
                ))
                image_count += 1

            # Update documents.image_count
            if image_count > 0:
                await sess.execute(
                    sa_text(
                        "UPDATE documents SET image_count = :cnt, updated_at = :ts "
                        "WHERE id = CAST(:id AS uuid)"
                    ),
                    {"cnt": image_count, "ts": now, "id": str(document_id)},
                )

        logger.info(
            "Image extraction complete",
            doc_id=str(document_id),
            image_count=image_count,
        )
    except Exception as e:
        logger.error("Image extraction failed", doc_id=str(document_id), error=str(e), exc_info=True)


@router.get("", response_model=list[DocumentResponse])
async def list_docs(
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    docs = await list_documents(session, ctx.org_id)
    return [_doc_to_response(d) for d in docs if d.document_type == "file" and d.session_id is None]


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
    extract_images: str = Form("false"),
    base_urls: str = Form(""),
    org_id: str | None = Form(None),
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
    tags: dict = {
        "roles": roles_list,
        "doc-type": doc_type.strip(),
        "confidential": "true" if is_confidential.lower() == "true" else "false",
        "user-id": str(ctx.user_id),
    }
    if base_urls.strip():
        tags["base_urls"] = [u.strip() for u in base_urls.split(",") if u.strip()]

    target_org_id = ctx.org_id
    if org_id and ctx.role and ctx.role.value == "super_admin":
        target_org_id = UUID(org_id)

    async with db_session(target_org_id) as session:
        doc = await create_document(
            session,
            org_id=target_org_id,
            user_id=ctx.user_id,
            filename=filename,
            s3_key="",
            mime_type=mime_type,
            size_bytes=size_bytes,
            tags=tags,
            description=description.strip() or None,
        )
        s3_key = make_s3_key(str(target_org_id), str(doc.id), ext)
        doc.s3_key = s3_key
        session.add(doc)
        await session.flush()
        doc_id = doc.id
        doc_snapshot = _doc_to_response(doc)
        await log_action(session, ctx, "document.upload", "document", str(doc_id), {"filename": filename})

    await upload(s3_key, body, tags={"org_id": str(target_org_id), "document_id": str(doc_id)})

    background_tasks.add_task(
        _ingest_document_bg, doc_id, target_org_id, body, mime_type, filename,
        extract_images=(extract_images.lower() == "true"),
    )

    return {"task_id": None, "document": doc_snapshot}


@router.get("/{doc_id}/images/{image_id}")
async def serve_document_image(
    doc_id: UUID,
    image_id: UUID,
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
):
    """Redirect to a presigned S3 URL for the given document image."""
    from fastapi.responses import RedirectResponse

    result = await session.execute(
        sa_text(
            "SELECT s3_key FROM document_images "
            "WHERE id = CAST(:img_id AS uuid) AND document_id = CAST(:doc_id AS uuid)"
        ),
        {"img_id": str(image_id), "doc_id": str(doc_id)},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Image not found")

    s3_key = row[0]

    from app.integrations.s3 import _is_local_mode, _local_path, presigned_get

    if _is_local_mode():
        from fastapi.responses import FileResponse
        local_path = _local_path(s3_key)
        if not local_path.exists():
            raise HTTPException(status_code=404, detail="Image file not found on disk")
        # Determine media type from extension
        ext = local_path.suffix.lower().lstrip(".")
        media_type = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext}"
        return FileResponse(str(local_path), media_type=media_type)

    url = await presigned_get(s3_key)
    return RedirectResponse(url)


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
            download_url = await presigned_get(doc.s3_key, filename=doc.filename, content_type=doc.mime_type)
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
        url = await presigned_get(doc.s3_key, filename=doc.filename, content_type=doc.mime_type)
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
