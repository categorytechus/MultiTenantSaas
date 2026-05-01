import io
from typing import Iterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.embeddings import embed_batch
from app.models.document import Document, DocumentChunk, DocumentStatus
from app.services.documents import update_document_status
from app.core.logging import get_logger

logger = get_logger(__name__)

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100


def parse_document(body: bytes, mime_type: str | None) -> str:
    """
    Parse document bytes into plain text.
    Supports: PDF, DOCX, and plain text.
    """
    mime = (mime_type or "").lower()

    if mime == "application/pdf" or mime.endswith("/pdf"):
        return _parse_pdf(body)

    if mime in (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    ):
        return _parse_docx(body)

    # Fallback: try to decode as UTF-8 text
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return body.decode("latin-1")
        except Exception:
            return body.decode("utf-8", errors="replace")


def _parse_pdf(body: bytes) -> str:
    """Extract text from a PDF file."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(body))
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text.strip())
    return "\n\n".join(pages)


def _parse_docx(body: bytes) -> str:
    """Extract text from a DOCX file."""
    import docx

    doc = docx.Document(io.BytesIO(body))
    paragraphs = [para.text for para in doc.paragraphs if para.text.strip()]
    return "\n\n".join(paragraphs)


def chunk_text(
    text: str,
    size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[str]:
    """
    Split text into overlapping chunks of `size` chars with `overlap` chars overlap.
    """
    if not text:
        return []

    chunks = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = min(start + size, text_len)
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= text_len:
            break
        start += size - overlap

    return chunks


async def ingest(session: AsyncSession, doc: Document, body: bytes) -> None:
    """
    Full ingestion pipeline:
    1. Parse document bytes to text
    2. Chunk text
    3. Embed chunks in batch
    4. Insert DocumentChunk rows
    5. Mark document as ready

    On error, marks the document as failed.
    """
    try:
        logger.info("Starting ingestion", doc_id=str(doc.id))

        # Parse
        text = parse_document(body, doc.mime_type)
        if not text.strip():
            logger.warning("Document produced no text", doc_id=str(doc.id))
            await update_document_status(session, doc.id, DocumentStatus.FAILED)
            return

        # Chunk
        chunks = chunk_text(text)
        if not chunks:
            await update_document_status(session, doc.id, DocumentStatus.FAILED)
            return

        logger.info("Chunked document", doc_id=str(doc.id), chunk_count=len(chunks))

        # Embed all chunks in batch
        embeddings = await embed_batch(chunks)

        # Insert chunks
        for i, (chunk_text_content, embedding) in enumerate(zip(chunks, embeddings)):
            chunk = DocumentChunk(
                org_id=doc.org_id,
                document_id=doc.id,
                chunk_index=i,
                content=chunk_text_content,
                embedding=embedding,
            )
            session.add(chunk)

        await session.flush()

        # Mark ready
        await update_document_status(session, doc.id, DocumentStatus.READY)
        logger.info("Ingestion complete", doc_id=str(doc.id), chunks=len(chunks))

    except Exception as e:
        logger.error("Ingestion failed", doc_id=str(doc.id), error=str(e))
        try:
            await update_document_status(session, doc.id, DocumentStatus.FAILED)
        except Exception:
            pass
        raise
