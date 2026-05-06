from datetime import datetime, timezone
from uuid import UUID

from sqlmodel import Field, SQLModel


class SuperAdminAllowlist(SQLModel, table=True):
    __tablename__ = "super_admin_allowlist"

    user_id: UUID = Field(primary_key=True, foreign_key="users.id")
    status: str = Field(default="active", max_length=50)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

