from urllib.parse import urlparse
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.document import Document, DocumentStatus
from app.core.logging import get_logger

logger = get_logger(__name__)


async def list_documents(session: AsyncSession, org_id: UUID) -> list[Document]:
    """List all documents for an org (RLS handles filtering)."""
    result = await session.execute(
        select(Document).where(Document.org_id == org_id).order_by(Document.created_at.desc())
    )
    return list(result.scalars().all())


async def get_document(session: AsyncSession, doc_id: UUID) -> Document:
    """Get a document by ID. Raises 404 if not found."""
    doc = await session.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return doc


async def create_document(
    session: AsyncSession,
    org_id: UUID,
    user_id: UUID,
    filename: str,
    s3_key: str,
    mime_type: str | None,
    size_bytes: int | None,
) -> Document:
    """Create a new document record (file upload)."""
    doc = Document(
        org_id=org_id,
        uploaded_by=user_id,
        filename=filename,
        s3_key=s3_key,
        mime_type=mime_type,
        size_bytes=size_bytes,
        document_type="file",
        status=DocumentStatus.PROCESSING.value,
    )
    session.add(doc)
    await session.flush()
    logger.info("Document created", doc_id=str(doc.id), org_id=str(org_id))
    return doc


async def create_url_document(
    session: AsyncSession,
    org_id: UUID,
    user_id: UUID,
    source_url: str,
) -> Document:
    """Create a new document record for a web URL (no file, no S3 key)."""
    # Use the URL hostname + path as a human-readable filename
    parsed = urlparse(source_url)
    filename = (parsed.netloc + parsed.path).strip("/") or source_url

    doc = Document(
        org_id=org_id,
        uploaded_by=user_id,
        filename=filename,
        s3_key=None,
        source_url=source_url,
        document_type="url",
        mime_type="web",
        status=DocumentStatus.PROCESSING.value,
    )
    session.add(doc)
    await session.flush()
    logger.info("URL document created", doc_id=str(doc.id), org_id=str(org_id), url=source_url)
    return doc


async def delete_document(session: AsyncSession, doc_id: UUID) -> Document:
    """Delete a document record. Returns the deleted document for S3 cleanup."""
    doc = await get_document(session, doc_id)
    await session.delete(doc)
    await session.flush()
    logger.info("Document deleted", doc_id=str(doc_id))
    return doc


async def update_document_status(
    session: AsyncSession,
    doc_id: UUID,
    status_value: DocumentStatus | str,
) -> Document:
    """Update the status of a document."""
    doc = await get_document(session, doc_id)
    if isinstance(status_value, DocumentStatus):
        doc.status = status_value.value
    else:
        doc.status = str(status_value)
    session.add(doc)
    await session.flush()
    return doc
