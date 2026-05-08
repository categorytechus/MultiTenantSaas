from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class WebUrl(SQLModel, table=True):
    __tablename__ = "web_urls"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    org_id: UUID = Field(foreign_key="orgs.id", nullable=False, index=True)
    uploaded_by: UUID | None = Field(default=None, foreign_key="users.id")
    url: str = Field(nullable=False)
    title: str | None = Field(default=None, max_length=500)
    tags: dict[str, str] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    description: str | None = Field(default=None)
    status: str = Field(default="active")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
