from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.security import decode_access_token, oauth2_scheme
from app.core.tenancy import RequestContext, get_required_context
from app.services.auth import (
    get_me,
    login_user,
    logout_user,
    refresh_tokens,
    register_user,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: str
    email: str
    name: str | None
    role: str | None = None
    org_id: str | None = None
    created_at: str | None = None

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AuthWithUserResponse(AuthResponse):
    user: UserResponse


@router.post("/register", response_model=AuthWithUserResponse, status_code=201)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Register a new user and create their organization."""
    user, access_token, refresh_token = await register_user(
        session, body.email, body.password, body.name
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
    """Login with email and password."""
    user, access_token, refresh_token = await login_user(session, body.email, body.password)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {"id": str(user.id), "email": user.email, "name": user.name},
    }


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    body: RefreshRequest,
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Rotate refresh tokens."""
    new_access, new_refresh = await refresh_tokens(session, body.refresh_token)
    return {"access_token": new_access, "refresh_token": new_refresh}


@router.post("/logout", status_code=204)
async def logout(
    body: LogoutRequest,
    session: AsyncSession = Depends(get_db),
) -> None:
    """Revoke a refresh token."""
    await logout_user(session, body.refresh_token)


@router.get("/me", response_model=UserResponse)
async def me(
    ctx: RequestContext = Depends(get_required_context),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Return current user info including role and org from JWT context."""
    user = await get_me(session, ctx.user_id)
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": ctx.role.value if ctx.role else None,
        "org_id": str(ctx.org_id) if ctx.org_id else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }
