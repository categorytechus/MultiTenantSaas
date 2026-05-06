from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class Org(SQLModel, table=True):
    __tablename__ = "orgs"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slug: str = Field(unique=True, index=True)
    name: str = Field(nullable=False)
    domain: str | None = Field(default=None)
    status: str = Field(default="active", nullable=False)
    subscription_tier: str = Field(default="free", nullable=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OrgMembership(SQLModel, table=True):
    __tablename__ = "org_memberships"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False)
    role: str = Field(nullable=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
