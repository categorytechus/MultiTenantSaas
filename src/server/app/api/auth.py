import json
from typing import Any
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_db
from app.core.security import hash_password, verify_password
from app.core.tenancy import get_optional_tenant_context, get_required_context, RequestContext
from app.core.rbac import Role
from app.services.auth import (
    decode_google_oauth_state,
    decode_microsoft_oauth_state,
    fetch_google_userinfo,
    fetch_microsoft_userinfo,
    get_me,
    login_user,
    login_with_google_profile,
    login_with_microsoft_profile,
    logout_user,
    make_google_authorization_url,
    make_microsoft_authorization_url,
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


def _oauth_success_html(access_token: str, refresh_token: str, return_url: str) -> str:
    access_json = json.dumps(access_token)
    refresh_json = json.dumps(refresh_token)
    return_json = json.dumps(return_url)
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Signing in</title>
  </head>
  <body>
    <script>
      localStorage.setItem("accessToken", {access_json});
      localStorage.setItem("refreshToken", {refresh_json});
      sessionStorage.removeItem("userModules");
      sessionStorage.removeItem("userModulesUnrestricted");
      window.location.replace({return_json});
    </script>
  </body>
</html>"""


def _oauth_error_redirect(message: str) -> RedirectResponse:
    signin_url = f"{settings.PUBLIC_APP_URL.rstrip('/')}/auth/signin?oauthError={quote(message)}"
    return RedirectResponse(signin_url, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/google")
async def google_oauth_start(returnUrl: str | None = Query(default=None)) -> RedirectResponse:
    """Start Google OAuth and preserve a relative frontend return URL in signed state."""
    return RedirectResponse(make_google_authorization_url(returnUrl))


@router.get("/google/callback", response_model=None)
async def google_oauth_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Complete Google OAuth and issue the app's JWT/refresh token pair."""
    if error:
        return _oauth_error_redirect("Google sign-in was cancelled or denied.")
    if not code or not state:
        return _oauth_error_redirect("Google sign-in failed.")

    try:
        return_url = decode_google_oauth_state(state)
        profile = await fetch_google_userinfo(code)
        _user, access_token, refresh_token = await login_with_google_profile(session, profile)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Google sign-in failed."
        return _oauth_error_redirect(detail)

    return HTMLResponse(_oauth_success_html(access_token, refresh_token, return_url))


@router.get("/microsoft")
async def microsoft_oauth_start(returnUrl: str | None = Query(default=None)) -> RedirectResponse:
    """Start Microsoft OAuth and preserve a relative frontend return URL in signed state."""
    return RedirectResponse(make_microsoft_authorization_url(returnUrl))


@router.get("/microsoft/callback", response_model=None)
async def microsoft_oauth_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Complete Microsoft OAuth and issue the app's JWT/refresh token pair."""
    if error:
        return _oauth_error_redirect("Microsoft sign-in was cancelled or denied.")
    if not code or not state:
        return _oauth_error_redirect("Microsoft sign-in failed.")

    try:
        return_url = decode_microsoft_oauth_state(state)
        profile = await fetch_microsoft_userinfo(code)
        _user, access_token, refresh_token = await login_with_microsoft_profile(session, profile)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "Microsoft sign-in failed."
        return _oauth_error_redirect(detail)

    return HTMLResponse(_oauth_success_html(access_token, refresh_token, return_url))


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


class SetPasswordRequest(BaseModel):
    token: str
    email: str
    password: str


@router.post("/set-password")
async def set_password_via_token(
    body: SetPasswordRequest,
    session: AsyncSession = Depends(get_db),
) -> dict:
    from datetime import datetime, timezone

    from sqlmodel import select

    from app.core.identity import normalize_email
    from app.models.invite import InviteToken
    from app.models.user import User as UserModel

    email = normalize_email(body.email)
    result = await session.execute(
        select(InviteToken).where(InviteToken.token == body.token, InviteToken.email == email)
    )
    invite = result.scalars().first()
    if not invite:
        return {"success": False, "message": "Invalid or expired link."}

    now = datetime.now(timezone.utc)
    if invite.expires_at.replace(tzinfo=timezone.utc) < now:
        return {"success": False, "message": "This link has expired."}
    if invite.used_at:
        return {"success": False, "message": "This link has already been used."}
    if len(body.password) < 8:
        return {"success": False, "message": "Password must be at least 8 characters."}

    user_result = await session.execute(select(UserModel).where(UserModel.email == email))
    user = user_result.scalars().first()
    if not user:
        return {"success": False, "message": "Account not found. Please contact your administrator."}

    user.hashed_password = hash_password(body.password)
    session.add(user)
    invite.used_at = now
    session.add(invite)
    await session.flush()
    return {"success": True}


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
