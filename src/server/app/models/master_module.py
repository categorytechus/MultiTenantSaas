from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Field, SQLModel


class MasterModule(SQLModel, table=True):
    __tablename__ = "master_modules"

    id: str = Field(primary_key=True, max_length=50)
    name: str = Field(nullable=False, max_length=120)
    label: Optional[str] = Field(default=None, max_length=120)
    description: Optional[str] = Field(default=None)
    parent_id: Optional[str] = Field(default=None, foreign_key="master_modules.id")
    sort_order: int = Field(default=100, nullable=False)
    permission_keys: List[str] = Field(
        default_factory=list,
        sa_column=Column(ARRAY(String(100)), nullable=False, server_default="{}"),
    )
    enabled: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def display_label(self) -> str:
        return self.label or self.name

    def display_description(self) -> str:
        return self.description or f"Manage access to {self.name.lower()} features."
