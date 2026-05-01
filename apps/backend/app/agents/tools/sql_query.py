from typing import Any

import sqlglot
import sqlglot.expressions as exp
from sqlalchemy import text

from app.agents.context import AgentContext
from app.core.logging import get_logger

logger = get_logger(__name__)

ALLOW_LIST = [
    "documents",
    "document_chunks",
    "chat_sessions",
    "chat_messages",
    "agent_tasks",
]


class SQLValidationError(Exception):
    """Raised when SQL validation fails."""
    pass


def validate_sql(sql: str) -> str:
    """
    Validate SQL using sqlglot:
    1. Must be a SELECT statement only
    2. Tables must be in ALLOW_LIST
    3. Injects LIMIT 100 if no LIMIT is present
    4. Returns the validated/transformed SQL string

    Raises SQLValidationError on validation failure.
    """
    sql = sql.strip().rstrip(";")

    # Parse the SQL
    try:
        parsed = sqlglot.parse_one(sql, dialect="postgres")
    except sqlglot.errors.ParseError as e:
        raise SQLValidationError(f"SQL parse error: {e}") from e

    if parsed is None:
        raise SQLValidationError("Empty or invalid SQL")

    # Must be a SELECT statement
    if not isinstance(parsed, exp.Select):
        raise SQLValidationError(
            f"Only SELECT statements are allowed, got: {type(parsed).__name__}"
        )

    # Check for forbidden clauses (extra safety)
    for node in parsed.walk():
        if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create)):
            raise SQLValidationError(f"Forbidden SQL operation: {type(node).__name__}")

    # Extract all table references
    tables_used = set()
    for table in parsed.find_all(exp.Table):
        table_name = table.name.lower()
        if table_name:
            tables_used.add(table_name)

    # Validate all tables are in allow-list
    disallowed = tables_used - set(ALLOW_LIST)
    if disallowed:
        raise SQLValidationError(
            f"Tables not in allow-list: {', '.join(sorted(disallowed))}. "
            f"Allowed tables: {', '.join(ALLOW_LIST)}"
        )

    # Inject LIMIT 100 if no limit present
    if parsed.args.get("limit") is None:
        parsed = parsed.limit(100)

    return parsed.sql(dialect="postgres")


async def sql_query_tool(ctx: AgentContext, sql: str) -> dict[str, Any]:
    """
    Execute a validated SQL query in a read-only session.
    RLS automatically enforces org_id scoping.

    Returns a dict with columns, rows, and row_count.
    """
    # Validate first
    validated_sql = validate_sql(sql)

    # Execute against the RLS-scoped session
    result = await ctx.session.execute(text(validated_sql))
    columns = list(result.keys())
    rows = [list(row) for row in result.fetchall()]

    return {
        "sql": validated_sql,
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
    }
