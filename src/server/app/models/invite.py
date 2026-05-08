from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class InviteToken(SQLModel, table=True):
    __tablename__ = "invite_tokens"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    token: str = Field(unique=True, index=True, max_length=64)
    email: str = Field(index=True)
    org_id: UUID = Field(foreign_key="orgs.id", index=True)
    role: str = Field(default="user", max_length=50)
    invited_by: UUID | None = Field(default=None, foreign_key="users.id")
    expires_at: datetime
    used_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
