from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.db import get_db
from app.core.rbac import authorize
from app.core.tenancy import RequestContext
from app.models.web_url import WebUrl

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
    ctx: RequestContext = authorize("web_urls:create"),
    session: AsyncSession = Depends(get_db),
):
    title = body.url.split("//")[-1].split("/")[0] if "://" in body.url else body.url
    row = WebUrl(
        org_id=ctx.org_id,
        uploaded_by=ctx.user_id,
        url=body.url.strip(),
        title=title[:500],
        tags=body.tags or {},
        description=body.description,
        status="active",
    )
    session.add(row)
    await session.flush()
    return {"success": True, "data": _to_row(row)}


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
