import asyncio
from typing import Any
from uuid import UUID

from app.core.db import db_session
from app.core.logging import get_logger
from app.integrations.s3 import download as s3_download
from app.models.document import DocumentStatus
from app.services.documents import get_document, update_document_status
from app.services.ingestion import ingest

logger = get_logger(__name__)

# Retry configuration: 3 retries, exponential backoff 2s/8s/32s
RETRY_DELAYS = [2, 8, 32]


async def ingest_document(
    ctx: dict[str, Any],
    document_id: str,
    org_id: str,
) -> dict[str, Any]:
    """
    Arq job: Download and ingest a document.
    Retries up to 3 times with exponential backoff.
    On final failure, marks the document as failed.
    """
    job_try = ctx.get("job_try", 1)
    logger.info("Starting ingest job", document_id=document_id, org_id=org_id, attempt=job_try)

    try:
        async with db_session(org_id) as session:
            doc = await get_document(session, UUID(document_id))
            body = await s3_download(doc.s3_key)
            await ingest(session, doc, body)

        logger.info("Ingest job completed", document_id=document_id)
        return {"status": "success", "document_id": document_id}

    except Exception as e:
        logger.error("Ingest job failed", document_id=document_id, error=str(e), attempt=job_try)

        # On final failure, mark document as failed
        if job_try >= len(RETRY_DELAYS) + 1:
            try:
                async with db_session(org_id) as session:
                    await update_document_status(session, UUID(document_id), DocumentStatus.FAILED)
            except Exception as mark_err:
                logger.error("Failed to mark document as failed", error=str(mark_err))
        else:
            # Delay before retry
            delay = RETRY_DELAYS[min(job_try - 1, len(RETRY_DELAYS) - 1)]
            logger.info("Retrying ingest", document_id=document_id, delay=delay, next_attempt=job_try + 1)
            await asyncio.sleep(delay)

        raise  # Re-raise so Arq can handle retry logic


# Configure retry settings on the function
ingest_document.retry = 3  # type: ignore[attr-defined]
