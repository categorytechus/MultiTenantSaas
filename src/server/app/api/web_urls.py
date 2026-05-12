from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.db import db_session, get_db
from app.core.logging import get_logger
from app.core.rbac import authorize
from app.core.tenancy import RequestContext
from app.models.web_url import WebUrl
from app.models.document import Document
from app.services.documents import create_url_document
from app.services.audit import log_action

# Import the background ingestion function from documents
# We'll use a late import to avoid circular dependencies
logger = get_logger(__name__)

router = APIRouter(prefix="/api/web-urls", tags=["web-urls"])


class WebUrlCreateRequest(BaseModel):
    url: str
    tags: dict | None = None
    description: str | None = None


class WebUrlUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    url: str
    tags: dict | None = None
    description: str | None = None


def _to_row(item: WebUrl) -> dict:
    return {
        "id": str(item.id),
        "url": item.url,
        "title": item.title or "",
        "tags": item.tags or {},
        "description": item.description,
        "status": item.status,
        "created_at": item.created_at.isoformat(),
        "processing_speed": None,
    }


@router.get("")
async def list_web_urls(
    ctx: RequestContext = authorize("web_urls:view"),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(WebUrl).where(WebUrl.org_id == ctx.org_id).order_by(WebUrl.created_at.desc())
    )
    rows = result.scalars().all()
    return {"data": [_to_row(r) for r in rows]}


@router.post("")
async def create_web_url(
    body: WebUrlCreateRequest,
    background_tasks: BackgroundTasks,
    ctx: RequestContext = authorize("web_urls:create"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Create a web URL and trigger background ingestion.
    This creates both a WebUrl record (for management) and a Document record (for ingestion).
    """
    # Validate URL format
    url_stripped = body.url.strip()
    parsed = urlparse(url_stripped)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only http:// and https:// URLs are supported.",
        )

    title = parsed.netloc if "://" in url_stripped else url_stripped
    
    # Create WebUrl record (for management UI)
    web_url_row = WebUrl(
        org_id=ctx.org_id,
        uploaded_by=ctx.user_id,
        url=url_stripped,
        title=title[:500],
        tags=body.tags or {},
        description=body.description,
        status="processing",
    )
    session.add(web_url_row)
    await session.flush()
    
    # Create Document record (for ingestion) and enqueue background job
    async with db_session(ctx.org_id) as doc_session:
        doc = await create_url_document(
            doc_session,
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            source_url=url_stripped,
        )
        doc_id = doc.id
        doc_snapshot = {
            "id": str(doc.id),
            "filename": doc.filename,
            "mime_type": doc.mime_type,
            "size_bytes": doc.size_bytes,
            "status": doc.status,
            "s3_key": doc.s3_key,
            "source_url": doc.source_url,
            "document_type": doc.document_type,
            "created_at": doc.created_at.isoformat(),
        }
        await log_action(
            doc_session, ctx, "web_url.create", "web_url", str(web_url_row.id), 
            {"url": url_stripped}
        )
    
    # Enqueue background ingestion task.
    # The import of _ingest_document_bg is intentionally placed here to avoid a circular dependency
    # between app.api.web_urls and app.api.documents. If moved to the top, it would cause an import error.
    from app.api.documents import _ingest_document_bg
    background_tasks.add_task(
        _ingest_document_bg,
        doc_id,
        ctx.org_id,
        None,                  # no file bytes
        None,                  # no mime_type
        doc_snapshot["filename"],
        url_stripped,          # source_url → triggers URL fetch branch
        web_url_row.id,        # mirrors status back to the WebUrl record
    )
    
    return {
        "success": True,
        "data": _to_row(web_url_row),
        "document": doc_snapshot,
    }


@router.put("/{url_id}")
async def update_web_url(
    url_id: UUID,
    body: WebUrlUpdateRequest,
    ctx: RequestContext = authorize("web_urls:update"),
    session: AsyncSession = Depends(get_db),
):
    row = await session.get(WebUrl, url_id)
    if not row or row.org_id != ctx.org_id:
        raise HTTPException(status_code=404, detail="Web URL not found")

    row.url = body.url.strip()
    row.tags = body.tags or {}
    row.description = body.description
    row.title = (row.url.split("//")[-1].split("/")[0] if "://" in row.url else row.url)[:500]
    session.add(row)
    await session.flush()
    return {"success": True, "data": _to_row(row)}


@router.delete("/{url_id}")
async def delete_web_url(
    url_id: UUID,
    ctx: RequestContext = authorize("web_urls:delete"),
    session: AsyncSession = Depends(get_db),
):
    row = await session.get(WebUrl, url_id)
    if not row or row.org_id != ctx.org_id:
        raise HTTPException(status_code=404, detail="Web URL not found")
    await session.delete(row)
    await session.flush()
    return {"success": True}
