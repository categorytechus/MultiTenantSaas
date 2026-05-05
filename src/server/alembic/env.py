import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

from sqlmodel import SQLModel

# Import all models so their metadata is registered
import app.models.user  # noqa: F401
import app.models.org  # noqa: F401
import app.models.chat  # noqa: F401
import app.models.document  # noqa: F401
import app.models.agent_task  # noqa: F401
import app.models.audit_log  # noqa: F401

config = context.config

# Allow `docker compose run ... -e DATABASE_URL=...@postgres:5432/...` and host `.env` workflows.
_database_url = os.environ.get("DATABASE_URL")
if _database_url:
    config.set_main_option("sqlalchemy.url", _database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    version_table = config.get_main_option("version_table") or None
    configure_kwargs = dict(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    if version_table:
        configure_kwargs["version_table"] = version_table
    context.configure(**configure_kwargs)

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        version_table = config.get_main_option("version_table") or None
        configure_kwargs = dict(
            connection=connection,
            target_metadata=target_metadata,
        )
        if version_table:
            configure_kwargs["version_table"] = version_table
        context.configure(**configure_kwargs)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
