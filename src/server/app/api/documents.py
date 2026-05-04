import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
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
    size_bytes: int | None
    status: str
    s3_key: str
    created_at: str
    download_url: str | None = None
    extracted_title: str | None = None
    summary: str | None = None
    keywords: list[str] | None = None


def _doc_to_response(doc, download_url: str | None = None) -> dict:
    kw = doc.keywords
    if isinstance(kw, str):
        try:
            kw = json.loads(kw)
        except Exception:
            kw = None
    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "mime_type": doc.mime_type,
        "size_bytes": doc.size_bytes,
        "status": doc.status,
        "s3_key": doc.s3_key,
        "created_at": doc.created_at.isoformat(),
        "download_url": download_url,
        "extracted_title": doc.extracted_title,
        "summary": doc.summary,
        "keywords": kw if isinstance(kw, list) else None,
    }


async def _ingest_document_bg(
    document_id: UUID,
    org_id: UUID,
    body: bytes,
    mime_type: str | None,
    filename: str = "document",
) -> None:
    """
    Background ingestion: parse → chunk → embed → generate metadata → insert chunks → mark ready.
    Runs after the upload transaction has committed, so all DB writes are fresh sessions.
    """
    from sqlalchemy import text as sa_text

    async def _set_status(s: str) -> None:
        try:
            async with db_session(org_id) as sess:
                await sess.execute(
                    sa_text("UPDATE documents SET status = :s WHERE id = CAST(:id AS uuid)"),
                    {"s": s, "id": str(document_id)},
                )
        except Exception:
            pass

    try:
        text = parse_document(body, mime_type)
        if not text.strip():
            logger.warning("Document produced no text", doc_id=str(document_id))
            await _set_status(DocumentStatus.FAILED.value)
            return

        chunks = chunk_text(text)
        logger.info("Chunked document for ingestion", doc_id=str(document_id), chunk_count=len(chunks))

        embeddings, metadata = await _run_parallel(
            embed_batch(chunks),
            generate_document_metadata(text, filename),
        )

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
            await sess.execute(
                sa_text(
                    "UPDATE documents SET status = :s, extracted_title = :title, "
                    "summary = :summary, keywords = CAST(:keywords AS json) "
                    "WHERE id = CAST(:id AS uuid)"
                ),
                {
                    "s": DocumentStatus.READY.value,
                    "id": str(document_id),
                    "title": metadata.get("title") or None,
                    "summary": metadata.get("summary") or None,
                    "keywords": json.dumps(metadata.get("keywords") or []),
                },
            )

        logger.info("Ingestion complete", doc_id=str(document_id), chunks=len(chunks))

    except Exception as e:
        logger.error("Background ingestion failed", doc_id=str(document_id), error=str(e))
        await _set_status(DocumentStatus.FAILED.value)


async def _run_parallel(*coros):
    import asyncio
    return await asyncio.gather(*coros)


@router.get("", response_model=list[DocumentResponse])
async def list_docs(
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    docs = await list_documents(session, ctx.org_id)
    return [_doc_to_response(d) for d in docs]


@router.post("", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    ctx: RequestContext = authorize("documents:upload"),
) -> Any:
    """
    Upload a document (<50MB). Commits the document record first, then runs
    ingestion as a background task so the FK constraint is satisfied.
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

    # Commit document record in its own transaction so background task sees it
    async with db_session(ctx.org_id) as session:
        doc = await create_document(
            session,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            filename=filename,
            s3_key="",
            mime_type=mime_type,
            size_bytes=size_bytes,
        )
        s3_key = make_s3_key(str(ctx.org_id), str(doc.id), ext)
        doc.s3_key = s3_key
        session.add(doc)
        await session.flush()
        doc_id = doc.id
        doc_snapshot = _doc_to_response(doc)
        await log_action(session, ctx, "document.upload", "document", str(doc_id), {"filename": filename})
    # Transaction committed here — document is now visible to other sessions

    await upload(s3_key, body, tags={"org_id": str(ctx.org_id), "document_id": str(doc_id)})

    background_tasks.add_task(_ingest_document_bg, doc_id, ctx.org_id, body, mime_type, filename)

    return {"task_id": None, "document": doc_snapshot}


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_doc(
    doc_id: UUID,
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    doc = await get_document(session, doc_id)
    download_url = await presigned_get(doc.s3_key) if doc.s3_key else None
    return _doc_to_response(doc, download_url)


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
