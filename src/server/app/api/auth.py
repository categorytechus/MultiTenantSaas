from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.security import hash_password, verify_password
from app.core.tenancy import get_optional_tenant_context, get_required_context, RequestContext
from app.core.rbac import Role
from app.services.auth import (
    get_me,
    login_user,
    logout_user,
    refresh_tokens,
    register_user,
    revoke_all_refresh_tokens,
)
from app.services.invite_service import (
    accept_invite_for_user,
    complete_signup_with_invite,
    invite_info_payload,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    organization_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class InviteSignupBody(BaseModel):
    token: str
    email: str
    name: str
    password: str = Field(..., min_length=8)


class AcceptInviteBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    token: str
    org_id: UUID = Field(alias="orgId")


class LogoutRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: str
    email: str
    name: str | None
    role: str | None = None
    org_id: str | None = None
    user_type: str | None = None
    created_at: str | None = None

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AuthWithUserResponse(AuthResponse):
    user: UserResponse


@router.post("/register", response_model=AuthWithUserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Register a user and create their first organization."""
    user, access_token, refresh_token = await register_user(
        session,
        body.email,
        body.password,
        body.name,
        organization_name=body.organization_name,
    )
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {"id": str(user.id), "email": user.email, "name": user.name},
    }


@router.post("/login", response_model=AuthWithUserResponse)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_db),
) -> Any:
    user, access_token, refresh_token = await login_user(session, body.email, body.password)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {"id": str(user.id), "email": user.email, "name": user.name},
    }


@router.get("/invite-info")
async def invite_info(
    token: str,
    org_id: UUID = Query(..., alias="orgId"),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Public lookup for signup / accept-invite pages (expects `{ success, data?, message? }`)."""
    return await invite_info_payload(session, token=token, org_id=org_id)


@router.post("/signup/{org_id}")
async def signup_via_org_invite(
    org_id: UUID,
    body: InviteSignupBody,
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Create a user bound to `org_id` when `body.token` is a valid, unused invite."""
    return await complete_signup_with_invite(
        session,
        org_id=org_id,
        token=body.token,
        email=body.email,
        name=body.name,
        password=body.password,
    )


@router.post("/accept-invite")
async def accept_invite(
    body: AcceptInviteBody,
    ctx: RequestContext = Depends(get_optional_tenant_context),
    session: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Add the authenticated user to the invited org (invite must match email)."""
    return await accept_invite_for_user(
        session,
        user_id=ctx.user_id,
        token=body.token,
        org_id=body.org_id,
    )


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    body: RefreshRequest,
    session: AsyncSession = Depends(get_db),
) -> Any:
    new_access, new_refresh = await refresh_tokens(session, body.refresh_token)
    return {"access_token": new_access, "refresh_token": new_refresh}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: LogoutRequest,
    session: AsyncSession = Depends(get_db),
) -> None:
    await logout_user(session, body.refresh_token)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all_sessions(
    ctx: RequestContext = Depends(get_optional_tenant_context),
    session: AsyncSession = Depends(get_db),
) -> None:
    await revoke_all_refresh_tokens(session, ctx.user_id)


class UpdateProfileRequest(BaseModel):
    name: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.get("/me", response_model=UserResponse)
async def me(
    ctx: RequestContext = Depends(get_optional_tenant_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    user = await get_me(session, ctx.user_id)
    user_type = "super_admin" if ctx.role == Role.SUPER_ADMIN else "user"
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": ctx.role.value if ctx.role else None,
        "org_id": str(ctx.org_id) if ctx.org_id else None,
        "user_type": user_type,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.put("/me", response_model=UserResponse)
async def update_profile(
    body: UpdateProfileRequest,
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    from app.models.user import User as UserModel

    user = await session.get(UserModel, ctx.user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    user.name = body.name
    session.add(user)
    await session.flush()
    user_type = "super_admin" if ctx.role == Role.SUPER_ADMIN else "user"
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": ctx.role.value if ctx.role else None,
        "org_id": str(ctx.org_id) if ctx.org_id else None,
        "user_type": user_type,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    ctx: RequestContext = Depends(get_optional_tenant_context),
    session: AsyncSession = Depends(get_db),
) -> None:
    from app.models.user import User as UserModel

    user = await session.get(UserModel, ctx.user_id)
    if not user or not user.hashed_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot change password")
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 8 characters",
        )
    user.hashed_password = hash_password(body.new_password)
    session.add(user)
    await revoke_all_refresh_tokens(session, user.id)
