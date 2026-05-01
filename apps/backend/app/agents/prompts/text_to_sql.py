from typing import Any

ALLOWED_TABLES = [
    "documents",
    "document_chunks",
    "chat_sessions",
    "chat_messages",
    "agent_tasks",
]

PLAN_SYSTEM_PROMPT = """You are a SQL planning assistant for a multi-tenant SaaS application.
Your job is to analyze a natural language question and identify which database tables are needed.

Available tables:
- documents: Uploaded files/documents (id, org_id, filename, mime_type, size_bytes, status, created_at)
- document_chunks: Text chunks from documents with embeddings (id, org_id, document_id, chunk_index, content, created_at)
- chat_sessions: Chat conversation sessions (id, org_id, user_id, title, created_at)
- chat_messages: Individual chat messages (id, org_id, chat_id, role, content, created_at)
- agent_tasks: AI agent task executions (id, org_id, user_id, type, status, input, output, created_at, completed_at)

Respond with a JSON object:
{
  "tables": ["table1", "table2"],
  "description": "Brief description of what query is needed"
}"""

GENERATE_SYSTEM_PROMPT = """You are a SQL generation assistant for a PostgreSQL database.
Generate a SELECT query based on the user's question and available tables.

Rules:
- Only use SELECT statements (no INSERT, UPDATE, DELETE, DROP, etc.)
- Only reference tables from the allowed list: {tables}
- All tables have an org_id column that is automatically filtered by RLS
- Include reasonable column selections (avoid SELECT *)
- Add a LIMIT clause (max 100 rows) if not present
- Use standard PostgreSQL syntax

Respond with ONLY the SQL query, no explanation or markdown.
Example output:
SELECT id, filename, status, created_at FROM documents ORDER BY created_at DESC LIMIT 10"""

FORMAT_SYSTEM_PROMPT = """You are a helpful data analyst. Given a SQL query result,
provide a clear natural language summary followed by the key findings.

Format your response as:
1. A 1-2 sentence summary of what was found
2. The key data points or insights
3. Any notable patterns or observations

Be concise and focus on actionable insights."""


def build_plan_messages(question: str) -> list[dict[str, Any]]:
    """Build messages for the plan step."""
    return [
        {"role": "system", "content": PLAN_SYSTEM_PROMPT},
        {"role": "user", "content": f"Question: {question}"},
    ]


def build_generate_messages(
    question: str,
    tables: list[str],
    previous_sql: str | None = None,
    validation_error: str | None = None,
) -> list[dict[str, Any]]:
    """Build messages for the SQL generation step."""
    system = GENERATE_SYSTEM_PROMPT.format(tables=", ".join(tables))
    user_content = f"Question: {question}\nRelevant tables: {', '.join(tables)}"

    if previous_sql and validation_error:
        user_content += f"\n\nPrevious SQL attempt:\n{previous_sql}\n\nValidation error: {validation_error}\n\nPlease fix the SQL."

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]


def build_format_messages(
    question: str,
    sql: str,
    result: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build messages for the format/answer step."""
    rows = result.get("rows", [])
    columns = result.get("columns", [])
    row_count = result.get("row_count", 0)

    # Format result as a simple table preview
    if rows and columns:
        header = " | ".join(columns)
        separator = "-" * len(header)
        rows_preview = "\n".join(" | ".join(str(v) for v in row) for row in rows[:20])
        table_text = f"{header}\n{separator}\n{rows_preview}"
        if row_count > 20:
            table_text += f"\n... ({row_count - 20} more rows)"
    else:
        table_text = "No rows returned."

    user_content = f"""Question: {question}

SQL Query executed:
{sql}

Query results ({row_count} rows):
{table_text}

Please provide a natural language summary of these results."""

    return [
        {"role": "system", "content": FORMAT_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
