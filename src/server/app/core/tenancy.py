import uuid
from dataclasses import dataclass, field
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer

from app.core.rbac import Role
from app.core.security import decode_access_token, oauth2_scheme

# Optional scheme — doesn't raise if token is missing
optional_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


@dataclass
class RequestContext:
    org_id: UUID | None = None
    user_id: UUID | None = None
    role: Role | None = None
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    email: str | None = None
    tenant_slug: str | None = None


def _resolve_org_from_host(host: str | None) -> str | None:
    """
    Try to extract tenant slug from subdomain.
    e.g. acme.example.com -> "acme"
    Returns None for localhost or bare domains.
    """
    if not host:
        return None
    hostname = host.split(":")[0]
    if hostname in ("localhost", "127.0.0.1", "0.0.0.0") or hostname.replace(".", "").isdigit():
        return None
    parts = hostname.split(".")
    if len(parts) >= 3:
        return parts[0]
    return None


async def get_request_context(
    request: Request,
    token: str | None = Depends(optional_oauth2_scheme),
) -> RequestContext:
    if not token:
        token = request.query_params.get("token") or None
    request_id = str(uuid.uuid4())
    ctx = RequestContext(request_id=request_id)

    if not token:
        return ctx

    try:
        payload = decode_access_token(token)
    except HTTPException:
        return ctx

    user_id_str: str | None = payload.get("sub")
    org_id_str: str | None = payload.get("org_id")
    role_str: str | None = payload.get("role")
    email: str | None = payload.get("email")
    tenant_slug: str | None = payload.get("tenant_slug")

    if user_id_str:
        try:
            ctx.user_id = UUID(user_id_str)
        except ValueError:
            pass

    if org_id_str:
        try:
            ctx.org_id = UUID(org_id_str)
        except ValueError:
            pass

    if role_str:
        try:
            ctx.role = Role(role_str)
        except ValueError:
            pass

    ctx.email = email
    ctx.tenant_slug = tenant_slug

    host = request.headers.get("host")
    slug_from_host = _resolve_org_from_host(host)

    if slug_from_host and tenant_slug and slug_from_host != tenant_slug:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant mismatch: host subdomain does not match JWT tenant",
        )

    return ctx


async def get_required_context(
    ctx: RequestContext = Depends(get_request_context),
) -> RequestContext:
    if ctx.user_id is None or ctx.org_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return ctx


async def get_optional_tenant_context(
    ctx: RequestContext = Depends(get_request_context),
) -> RequestContext:
    """Valid JWT subject required; tenant (`org_id`) may be omitted (super-admin bootstrap tokens)."""
    if ctx.user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return ctx


async def require_super_admin_user(
    ctx: RequestContext = Depends(get_request_context),
) -> RequestContext:
    """Super-admin role; tenant context optional."""
    if ctx.user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if ctx.role != Role.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin access required",
        )
    return ctx
