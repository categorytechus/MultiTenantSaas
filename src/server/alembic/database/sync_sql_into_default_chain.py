from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent
SQL_DIR = ROOT / "migrations"
VERSIONS_DIR = ROOT.parent / "versions"
PREFIX = "sqlsync_"
START_DOWN_REVISION = "003"


def _natural_key(path: Path) -> tuple[int, str]:
    prefix = path.name.split("_", 1)[0]
    return (int(prefix) if prefix.isdigit() else 10**9, path.name)


def _sanitize(stem: str) -> str:
    return "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in stem)


def _revision_id(index: int, stem: str) -> str:
    # Alembic version_num column is VARCHAR(32) by default: keep IDs short.
    return f"s{index:03d}"


def _file_name(index: int, stem: str) -> str:
    return f"{index + 3:03d}_{PREFIX}{_sanitize(stem)}.py"


def _render(revision: str, down_revision: str, sql_path: Path) -> str:
    sql_text = sql_path.read_text(encoding="utf-8")
    return f'''"""SQL sync from {sql_path.name}

Revision ID: {revision}
Revises: {down_revision}
Create Date: auto-generated
"""
from typing import Sequence, Union

from alembic import op


revision: str = "{revision}"
down_revision: Union[str, None] = "{down_revision}"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SQL_TEXT = {sql_text!r}


def upgrade() -> None:
    # Intentionally no-op: default executable schema is maintained by revisions 001..003.
    # This revision keeps legacy SQL text copied into the default Alembic chain for reference/audit.
    op.get_bind()


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade not implemented for SQL-synced migration: {sql_path.name}"
    )
'''


def main() -> None:
    VERSIONS_DIR.mkdir(parents=True, exist_ok=True)

    # Remove prior generated SQL sync revisions to keep output deterministic.
    for existing in VERSIONS_DIR.glob(f"*_{PREFIX}*.py"):
        existing.unlink()

    sql_files = sorted(SQL_DIR.glob("*.sql"), key=_natural_key)
    down_revision = START_DOWN_REVISION
    count = 0
    for idx, sql_path in enumerate(sql_files, start=1):
        revision = _revision_id(idx, sql_path.stem)
        filename = _file_name(idx, sql_path.stem)
        target = VERSIONS_DIR / filename
        target.write_text(
            _render(revision=revision, down_revision=down_revision, sql_path=sql_path),
            encoding="utf-8",
        )
        down_revision = revision
        count += 1

    print(f"Generated {count} SQL-synced default-chain revisions in {VERSIONS_DIR}")


if __name__ == "__main__":
    main()
