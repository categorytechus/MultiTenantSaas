"""
API Modules CRUD routes.
Only tenant_admin and super_admin users can manage API modules.
auth_config is NEVER returned in list/get responses — masked as {"configured": true}.
"""
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.audit import log_action
from app.core.db import get_db
from app.core.rbac import Role
from app.core.tenancy import RequestContext, get_required_context
from app.models.api_module import ApiModule

router = APIRouter(prefix="/api/api-modules", tags=["api-modules"])

ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
ALLOWED_AUTH_TYPES = {"none", "bearer", "basic", "api_key"}


# ── Guards ────────────────────────────────────────────────────────────────────

def _require_admin(ctx: RequestContext) -> None:
    if ctx.role not in (Role.TENANT_ADMIN, Role.SUPER_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Admin privileges required")


def _mask_auth(module: ApiModule) -> dict[str, Any]:
    """Serialize a module, masking auth_config so secrets never leave the server."""
    return {
        "id": str(module.id),
        "org_id": str(module.org_id),
        "name": module.name,
        "description": module.description,
        "base_url": module.base_url,
        "method": module.method,
        "endpoint_path": module.endpoint_path,
        "auth_type": module.auth_type,
        "auth_configured": bool(module.auth_config),
        "headers": module.headers or {},
        "request_schema": module.request_schema,
        "response_schema": module.response_schema,
        "enabled": module.enabled,
        "ask_permission": module.ask_permission,
        "created_by": str(module.created_by) if module.created_by else None,
        "created_at": module.created_at.isoformat(),
        "updated_at": module.updated_at.isoformat(),
    }


# ── Request bodies ────────────────────────────────────────────────────────────

class CreateApiModuleRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str
    description: str
    base_url: str
    method: str
    endpoint_path: str = "/"
    auth_type: str = "none"
    auth_config: dict | None = None
    headers: dict | None = None
    request_schema: dict = Field(default_factory=dict)
    response_schema: dict | None = None
    enabled: bool = True
    ask_permission: bool = True


class UpdateApiModuleRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str | None = None
    description: str | None = None
    base_url: str | None = None
    method: str | None = None
    endpoint_path: str | None = None
    auth_type: str | None = None
    auth_config: dict | None = None
    headers: dict | None = None
    request_schema: dict | None = None
    response_schema: dict | None = None
    enabled: bool | None = None
    ask_permission: bool | None = None


class TestApiModuleRequest(BaseModel):
    input_payload: dict = Field(default_factory=dict)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=None)
async def list_api_modules(
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """List all API modules for the current org."""
    _require_admin(ctx)
    result = await session.execute(
        select(ApiModule)
        .where(
            ApiModule.org_id == ctx.org_id,
            ApiModule.deleted == False,
        )
        .order_by(ApiModule.created_at.desc())
    )
    modules = result.scalars().all()
    return {"success": True, "data": [_mask_auth(m) for m in modules]}


@router.post("", status_code=status.HTTP_201_CREATED, response_model=None)
async def create_api_module(
    body: CreateApiModuleRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Create a new API module configuration."""
    _require_admin(ctx)

    if body.method.upper() not in ALLOWED_METHODS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"method must be one of {sorted(ALLOWED_METHODS)}")
    if body.auth_type not in ALLOWED_AUTH_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"auth_type must be one of {sorted(ALLOWED_AUTH_TYPES)}")

    module = ApiModule(
        org_id=ctx.org_id,
        name=body.name.strip(),
        description=body.description.strip(),
        base_url=body.base_url.rstrip("/"),
        method=body.method.upper(),
        endpoint_path=body.endpoint_path or "/",
        auth_type=body.auth_type,
        auth_config=body.auth_config,
        headers=body.headers,
        request_schema=body.request_schema,
        response_schema=body.response_schema,
        enabled=body.enabled,
        ask_permission=body.ask_permission,
        created_by=ctx.user_id,
    )
    session.add(module)
    await session.flush()
    await log_action(session, ctx, "api_module.created", "api_module", str(module.id),
                     {"name": module.name})
    return {"success": True, "data": _mask_auth(module)}


@router.patch("/{module_id}", response_model=None)
async def update_api_module(
    module_id: UUID,
    body: UpdateApiModuleRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Update fields on an existing API module."""
    _require_admin(ctx)

    module = await session.get(ApiModule, module_id)
    if not module or module.org_id != ctx.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="API module not found")

    if body.name is not None:
        module.name = body.name.strip()
    if body.description is not None:
        module.description = body.description.strip()
    if body.base_url is not None:
        module.base_url = body.base_url.rstrip("/")
    if body.method is not None:
        if body.method.upper() not in ALLOWED_METHODS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"method must be one of {sorted(ALLOWED_METHODS)}")
        module.method = body.method.upper()
    if body.endpoint_path is not None:
        module.endpoint_path = body.endpoint_path
    if body.auth_type is not None:
        if body.auth_type not in ALLOWED_AUTH_TYPES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"auth_type must be one of {sorted(ALLOWED_AUTH_TYPES)}")
        module.auth_type = body.auth_type
    if body.auth_config is not None:
        module.auth_config = body.auth_config
    if body.headers is not None:
        module.headers = body.headers
    if body.request_schema is not None:
        module.request_schema = body.request_schema
    if body.response_schema is not None:
        module.response_schema = body.response_schema
    if body.enabled is not None:
        module.enabled = body.enabled
    if body.ask_permission is not None:
        module.ask_permission = body.ask_permission

    module.updated_at = datetime.now(timezone.utc)
    session.add(module)
    await session.flush()
    await log_action(session, ctx, "api_module.updated", "api_module", str(module.id),
                     {"name": module.name})
    return {"success": True, "data": _mask_auth(module)}


@router.delete("/{module_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_module(
    module_id: UUID,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> None:
    """Delete an API module. Soft deletes it to preserve logs/proposals."""
    _require_admin(ctx)

    module = await session.get(ApiModule, module_id)
    if not module or module.org_id != ctx.org_id or module.deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="API module not found")

    module.deleted = True
    module.enabled = False
    session.add(module)

    await log_action(session, ctx, "api_module.deleted", "api_module", str(module.id),
                     {"name": module.name})
    await session.flush()


@router.post("/{module_id}/test", response_model=None)
async def test_api_module(
    module_id: UUID,
    body: TestApiModuleRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Execute a test HTTP call to the stored endpoint using the stored auth config.
    Returns the raw HTTP status and response body (truncated to 10 KB).
    """
    _require_admin(ctx)

    module = await session.get(ApiModule, module_id)
    if not module or module.org_id != ctx.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="API module not found")

    url = f"{module.base_url.rstrip('/')}/{module.endpoint_path.lstrip('/')}"
    headers: dict[str, str] = dict(module.headers or {})
    _inject_auth(headers, module)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.request(
                method=module.method,
                url=url,
                headers=headers,
                json=body.input_payload if module.method in {"POST", "PUT", "PATCH"} else None,
                params=body.input_payload if module.method in {"GET", "DELETE"} else None,
            )
        body_text = resp.text[:10_000]
        return {
            "success": True,
            "data": {
                "http_status": resp.status_code,
                "response_preview": body_text,
            },
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}


# ── Auth injection helper (used here and by the API tool worker) ──────────────

def _inject_auth(headers: dict[str, str], module: ApiModule) -> None:
    """Mutate `headers` in-place to add auth from the stored auth_config."""
    cfg = module.auth_config or {}
    if module.auth_type == "bearer":
        token = cfg.get("token", "")
        if token:
            headers["Authorization"] = f"Bearer {token}"
    elif module.auth_type == "basic":
        import base64
        user = cfg.get("username", "")
        pw = cfg.get("password", "")
        encoded = base64.b64encode(f"{user}:{pw}".encode()).decode()
        headers["Authorization"] = f"Basic {encoded}"
    elif module.auth_type == "api_key":
        key_name = cfg.get("header_name", "X-API-Key")
        key_val = cfg.get("key", "")
        if key_val:
            headers[key_name] = key_val
