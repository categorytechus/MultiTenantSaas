"""
Document ingest job — self-contained, no SQLModel ORM.
Uses raw psycopg for DB access with RLS context set via SET LOCAL.
"""
import asyncio
import io
import uuid
from typing import Any

import psycopg
from pgvector.psycopg import register_vector_async

from app.config import settings
from app.embeddings import embed_batch
from app.s3 import download as s3_download

RETRY_DELAYS = [2, 8, 32]
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100


# ── Text extraction ────────────────────────────────────────────────────────────

def _parse_pdf(body: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(body))
    return "\n\n".join(p.extract_text().strip() for p in reader.pages if p.extract_text())


def _parse_docx(body: bytes) -> str:
    import docx
    doc = docx.Document(io.BytesIO(body))
    return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())


def parse_document(body: bytes, mime_type: str | None) -> str:
    mime = (mime_type or "").lower()
    if "pdf" in mime:
        return _parse_pdf(body)
    if "wordprocessingml" in mime or "msword" in mime:
        return _parse_docx(body)
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("utf-8", errors="replace")


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start += size - overlap
    return chunks


# ── DB helpers (raw psycopg, no ORM) ──────────────────────────────────────────

async def _set_rls(conn: psycopg.AsyncConnection, org_id: str) -> None:
    await conn.execute(f"SET LOCAL app.current_org_id = '{org_id}'")


async def _get_doc(conn: psycopg.AsyncConnection, document_id: str) -> tuple | None:
    cur = await conn.execute(
        "SELECT id, s3_key, mime_type FROM documents WHERE id = %s",
        [document_id],
    )
    return cur.fetchone()


async def _set_status(conn: psycopg.AsyncConnection, document_id: str, status: str) -> None:
    await conn.execute(
        "UPDATE documents SET status = %s WHERE id = %s",
        [status, document_id],
    )


async def _insert_chunks(
    conn: psycopg.AsyncConnection,
    org_id: str,
    document_id: str,
    chunks: list[str],
    embeddings: list[list[float]],
) -> None:
    for i, (content, embedding) in enumerate(zip(chunks, embeddings)):
        await conn.execute(
            """INSERT INTO document_chunks (id, org_id, document_id, chunk_index, content, embedding)
               VALUES (%s, %s::uuid, %s::uuid, %s, %s, %s)""",
            [str(uuid.uuid4()), org_id, document_id, i, content, embedding],
        )


# ── Arq job ───────────────────────────────────────────────────────────────────

async def ingest_document(
    ctx: dict[str, Any],
    *,
    document_id: str,
    org_id: str,
) -> dict[str, Any]:
    """Arq job: download file, parse, chunk, embed, store, mark ready."""
    job_try = ctx.get("job_try", 1)

    try:
        # Use a raw DATABASE_URL without the +psycopg dialect prefix
        db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

        async with await psycopg.AsyncConnection.connect(db_url) as conn:
            await register_vector_async(conn)

            async with conn.transaction():
                await _set_rls(conn, org_id)

                doc = await _get_doc(conn, document_id)
                if not doc:
                    raise ValueError(f"Document {document_id} not found")

                _, s3_key, mime_type = doc

                body = await s3_download(s3_key)
                text = parse_document(body, mime_type)

                if not text.strip():
                    await _set_status(conn, document_id, "failed")
                    return {"status": "no_text", "document_id": document_id}

                chunks = chunk_text(text)
                embeddings = await embed_batch(chunks)

                await _insert_chunks(conn, org_id, document_id, chunks, embeddings)
                await _set_status(conn, document_id, "ready")

        return {"status": "success", "document_id": document_id, "chunks": len(chunks)}

    except Exception as e:
        if job_try >= len(RETRY_DELAYS) + 1:
            try:
                db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
                async with await psycopg.AsyncConnection.connect(db_url) as conn:
                    async with conn.transaction():
                        await _set_rls(conn, org_id)
                        await _set_status(conn, document_id, "failed")
            except Exception:
                pass
        else:
            await asyncio.sleep(RETRY_DELAYS[min(job_try - 1, len(RETRY_DELAYS) - 1)])
        raise


ingest_document.retry = 3  # type: ignore[attr-defined]
