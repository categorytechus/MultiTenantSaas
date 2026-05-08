from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class OrgModule(SQLModel, table=True):
    __tablename__ = "org_modules"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(nullable=False, index=True)
    module_id: str = Field(nullable=False, max_length=50, index=True)
    assigned_by: UUID | None = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
