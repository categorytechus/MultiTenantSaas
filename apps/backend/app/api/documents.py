from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.rbac import authorize
from app.core.tenancy import RequestContext
from app.integrations.s3 import delete as s3_delete, make_s3_key, presigned_get, upload
from app.services.audit import log_action
from app.services.documents import (
    create_document,
    delete_document,
    get_document,
    list_documents,
)

router = APIRouter(prefix="/api/documents", tags=["documents"])

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


def _doc_to_response(doc, download_url: str | None = None) -> dict:
    return {
        "id": str(doc.id),
        "filename": doc.filename,
        "mime_type": doc.mime_type,
        "size_bytes": doc.size_bytes,
        "status": doc.status,
        "s3_key": doc.s3_key,
        "created_at": doc.created_at.isoformat(),
        "download_url": download_url,
    }


@router.get("/", response_model=list[DocumentResponse])
async def list_docs(
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """List documents for the current org."""
    docs = await list_documents(session, ctx.org_id)
    return [_doc_to_response(d) for d in docs]


@router.post("/", status_code=202)
async def upload_document(
    file: UploadFile = File(...),
    ctx: RequestContext = authorize("documents:upload"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Upload a document (<50MB).
    Streams through FastAPI, uploads to S3/local, enqueues ingestion job.
    Returns 202 Accepted.
    """
    # Read file body
    body = await file.read()

    if len(body) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Maximum size is 50MB.",
        )

    filename = file.filename or "upload"
    mime_type = file.content_type
    size_bytes = len(body)

    # Determine file extension
    ext = filename.rsplit(".", 1)[-1] if "." in filename else "bin"

    # Create document record first to get the ID
    doc = await create_document(
        session,
        org_id=ctx.org_id,
        user_id=ctx.user_id,
        filename=filename,
        s3_key="",  # Will be set after we have doc.id
        mime_type=mime_type,
        size_bytes=size_bytes,
    )

    # Build S3 key
    s3_key = make_s3_key(str(ctx.org_id), str(doc.id), ext)
    doc.s3_key = s3_key
    session.add(doc)
    await session.flush()

    # Upload to S3 or local
    await upload(
        s3_key,
        body,
        tags={"org_id": str(ctx.org_id), "document_id": str(doc.id)},
    )

    # Enqueue ingestion job
    from arq.connections import create_pool, RedisSettings
    from app.core.config import settings as app_settings

    try:
        redis_conn = await create_pool(RedisSettings.from_dsn(app_settings.REDIS_URL))
        await redis_conn.enqueue_job(
            "ingest_document",
            document_id=str(doc.id),
            org_id=str(ctx.org_id),
        )
        await redis_conn.aclose()
    except Exception as e:
        # Don't fail the upload if we can't enqueue — log and continue
        from app.core.logging import get_logger
        logger = get_logger(__name__)
        logger.error("Failed to enqueue ingest job", doc_id=str(doc.id), error=str(e))

    await log_action(session, ctx, "document.upload", "document", str(doc.id), {"filename": filename})

    return {"task_id": None, "document": _doc_to_response(doc)}


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_doc(
    doc_id: UUID,
    ctx: RequestContext = authorize("documents:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Get document details with a presigned download URL."""
    doc = await get_document(session, doc_id)
    download_url = await presigned_get(doc.s3_key) if doc.s3_key else None
    return _doc_to_response(doc, download_url)


@router.delete("/{doc_id}", status_code=204)
async def delete_doc(
    doc_id: UUID,
    ctx: RequestContext = authorize("documents:delete"),
    session: AsyncSession = Depends(get_db),
) -> None:
    """Delete a document and its S3 object."""
    doc = await delete_document(session, doc_id)
    if doc.s3_key:
        try:
            await s3_delete(doc.s3_key)
        except Exception as e:
            from app.core.logging import get_logger
            get_logger(__name__).warning("Failed to delete S3 object", key=doc.s3_key, error=str(e))
    await log_action(session, ctx, "document.delete", "document", str(doc_id))
