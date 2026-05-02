from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.db import get_db
from app.core.rbac import Role, authorize
from app.core.security import hash_password
from app.core.tenancy import RequestContext
from app.models.org import OrgMembership
from app.models.user import User
from app.services.audit import log_action

router = APIRouter(prefix="/api/users", tags=["users"])


class UserResponse(BaseModel):
    id: str
    email: str
    name: str | None
    role: str | None = None

    class Config:
        from_attributes = True


class InviteUserRequest(BaseModel):
    email: str
    name: str | None = None
    role: str = Role.USER.value
    password: str | None = None  # For direct user creation (MVP)


class UpdateUserRequest(BaseModel):
    role: str | None = None
    name: str | None = None


@router.get("/", response_model=list[UserResponse])
async def list_users(
    ctx: RequestContext = authorize("users:read"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """List all users in the current org."""
    # Get all memberships for the org
    memberships_result = await session.execute(
        select(OrgMembership).where(OrgMembership.org_id == ctx.org_id)
    )
    memberships = list(memberships_result.scalars().all())

    users = []
    for membership in memberships:
        user = await session.get(User, membership.user_id)
        if user:
            users.append({
                "id": str(user.id),
                "email": user.email,
                "name": user.name,
                "role": membership.role,
            })
    return users


@router.post("/invite", response_model=UserResponse, status_code=201)
async def invite_user(
    body: InviteUserRequest,
    ctx: RequestContext = authorize("users:invite"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """
    Create a user and add them to the current org.
    For MVP, this creates the user directly (no email invite flow).
    """
    # Validate role
    try:
        role = Role(body.role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")

    # Disallow inviting super_admin
    if role == Role.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Cannot assign super_admin role via invite")

    # Check if user already exists
    existing = await session.execute(select(User).where(User.email == body.email))
    user = existing.scalars().first()

    if user:
        # Check if already in this org
        existing_membership = await session.execute(
            select(OrgMembership).where(
                OrgMembership.user_id == user.id,
                OrgMembership.org_id == ctx.org_id,
            )
        )
        if existing_membership.scalars().first():
            raise HTTPException(status_code=409, detail="User already in org")
    else:
        # Create new user
        hashed = hash_password(body.password) if body.password else None
        user = User(email=body.email, name=body.name, hashed_password=hashed)
        session.add(user)
        await session.flush()

    # Add to org
    membership = OrgMembership(
        user_id=user.id,
        org_id=ctx.org_id,
        role=role.value,
    )
    session.add(membership)
    await session.flush()

    await log_action(session, ctx, "user.invite", "user", str(user.id), {"email": user.email})

    return {"id": str(user.id), "email": user.email, "name": user.name, "role": role.value}


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    ctx: RequestContext = authorize("users:update"),
    session: AsyncSession = Depends(get_db),
) -> Any:
    """Update a user's role or name within the current org."""
    # Verify user is in this org
    membership_result = await session.execute(
        select(OrgMembership).where(
            OrgMembership.user_id == user_id,
            OrgMembership.org_id == ctx.org_id,
        )
    )
    membership = membership_result.scalars().first()
    if not membership:
        raise HTTPException(status_code=404, detail="User not found in org")

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.role is not None:
        try:
            new_role = Role(body.role)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid role: {body.role}")
        if new_role == Role.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Cannot assign super_admin role")
        membership.role = new_role.value
        session.add(membership)

    if body.name is not None:
        user.name = body.name
        session.add(user)

    await session.flush()
    await log_action(session, ctx, "user.update", "user", str(user_id))

    return {"id": str(user.id), "email": user.email, "name": user.name, "role": membership.role}


@router.delete("/{user_id}", status_code=204)
async def remove_user(
    user_id: UUID,
    ctx: RequestContext = authorize("users:update"),
    session: AsyncSession = Depends(get_db),
) -> None:
    """Remove a user from the current org."""
    # Cannot remove yourself
    if user_id == ctx.user_id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")

    membership_result = await session.execute(
        select(OrgMembership).where(
            OrgMembership.user_id == user_id,
            OrgMembership.org_id == ctx.org_id,
        )
    )
    membership = membership_result.scalars().first()
    if not membership:
        raise HTTPException(status_code=404, detail="User not found in org")

    await session.delete(membership)
    await session.flush()
    await log_action(session, ctx, "user.remove", "user", str(user_id))
