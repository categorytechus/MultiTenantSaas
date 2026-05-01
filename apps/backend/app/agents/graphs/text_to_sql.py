import json
from datetime import datetime, timezone
from typing import Any, TypedDict
from uuid import UUID

from langgraph.graph import END, StateGraph
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.prompts.text_to_sql import (
    ALLOWED_TABLES,
    build_format_messages,
    build_generate_messages,
    build_plan_messages,
)
from app.agents.tools.sql_query import SQLValidationError, sql_query_tool, validate_sql
from app.agents.context import AgentContext
from app.core.logging import get_logger
from app.core.rbac import Role
from app.integrations.llm import llm

logger = get_logger(__name__)

MAX_RETRIES = 3


class TextToSQLState(TypedDict):
    question: str
    org_id: str
    user_id: str
    session: AsyncSession
    task_id: str
    # Computed during graph run
    tables: list[str]
    sql: str
    result: dict[str, Any]
    answer: str
    retries: int
    error: str | None
    validation_error: str | None


async def _publish_progress(state: TextToSQLState, event_type: str, data: Any) -> None:
    """Publish a progress event to Redis Pub/Sub."""
    from app.core.redis import publish, task_channel

    channel = task_channel(str(state["org_id"]), str(state["task_id"]))
    message = {
        "type": event_type,
        "data": data,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await publish(channel, message)
    except Exception as e:
        logger.warning("Failed to publish progress event", error=str(e))


async def plan_node(state: TextToSQLState) -> dict[str, Any]:
    """Classify the question and identify relevant tables."""
    await _publish_progress(state, "progress", {"step": "plan", "message": "Analyzing question..."})

    messages = build_plan_messages(state["question"])
    response = await llm.complete(messages)

    # Parse JSON response
    tables = ALLOWED_TABLES  # fallback
    try:
        # Extract JSON from response (handle markdown code blocks)
        response_text = response.strip()
        if "```" in response_text:
            import re
            match = re.search(r"```(?:json)?\s*(.*?)\s*```", response_text, re.DOTALL)
            if match:
                response_text = match.group(1)

        parsed = json.loads(response_text)
        raw_tables = parsed.get("tables", ALLOWED_TABLES)
        # Filter to only allowed tables
        tables = [t for t in raw_tables if t in ALLOWED_TABLES]
        if not tables:
            tables = ALLOWED_TABLES
    except (json.JSONDecodeError, KeyError):
        logger.warning("Failed to parse plan response, using all tables", response=response)

    await _publish_progress(state, "progress", {"step": "plan", "message": f"Using tables: {tables}"})
    return {"tables": tables, "retries": 0, "error": None, "validation_error": None}


async def generate_node(state: TextToSQLState) -> dict[str, Any]:
    """Generate SQL from the question using the identified tables."""
    await _publish_progress(
        state,
        "progress",
        {"step": "generate", "message": "Generating SQL query...", "attempt": state.get("retries", 0) + 1},
    )

    messages = build_generate_messages(
        question=state["question"],
        tables=state.get("tables", ALLOWED_TABLES),
        previous_sql=state.get("sql"),
        validation_error=state.get("validation_error"),
    )
    sql = await llm.complete(messages)

    # Strip markdown code blocks if present
    sql = sql.strip()
    if sql.startswith("```"):
        import re
        match = re.search(r"```(?:sql)?\s*(.*?)\s*```", sql, re.DOTALL)
        if match:
            sql = match.group(1).strip()

    await _publish_progress(state, "progress", {"step": "generate", "message": "SQL generated", "sql": sql})
    return {"sql": sql}


async def validate_node(state: TextToSQLState) -> dict[str, Any]:
    """Validate and sanitize the generated SQL."""
    await _publish_progress(state, "progress", {"step": "validate", "message": "Validating SQL..."})

    sql = state.get("sql", "")
    try:
        validated_sql = validate_sql(sql)
        await _publish_progress(state, "progress", {"step": "validate", "message": "SQL is valid"})
        return {"sql": validated_sql, "validation_error": None}
    except SQLValidationError as e:
        retries = state.get("retries", 0)
        new_retries = retries + 1
        logger.warning("SQL validation failed", error=str(e), attempt=new_retries)
        await _publish_progress(
            state,
            "progress",
            {"step": "validate", "message": f"Validation failed (attempt {new_retries}): {e}"},
        )
        return {"validation_error": str(e), "retries": new_retries}


async def execute_node(state: TextToSQLState) -> dict[str, Any]:
    """Execute the validated SQL query."""
    await _publish_progress(state, "progress", {"step": "execute", "message": "Executing query..."})

    session: AsyncSession = state["session"]
    org_id = UUID(str(state["org_id"]))
    user_id = UUID(str(state["user_id"]))
    task_id = UUID(str(state["task_id"]))

    ctx = AgentContext(
        org_id=org_id,
        user_id=user_id,
        session=session,
        role=Role.USER,
        task_id=task_id,
    )

    result = await sql_query_tool(ctx, state["sql"])
    await _publish_progress(
        state,
        "progress",
        {"step": "execute", "message": f"Query returned {result['row_count']} rows"},
    )
    return {"result": result}


async def format_node(state: TextToSQLState) -> dict[str, Any]:
    """Format the query result into a natural language answer."""
    await _publish_progress(state, "progress", {"step": "format", "message": "Formatting answer..."})

    messages = build_format_messages(
        question=state["question"],
        sql=state["sql"],
        result=state["result"],
    )
    answer = await llm.complete(messages)

    await _publish_progress(
        state,
        "done",
        {
            "answer": answer,
            "sql": state["sql"],
            "result": state["result"],
        },
    )
    return {"answer": answer}


def should_retry_or_fail(state: TextToSQLState) -> str:
    """
    Routing function after validate node.
    If validation error exists and retries < MAX_RETRIES, go back to generate.
    Otherwise proceed to execute, or end with error.
    """
    if state.get("validation_error"):
        if state.get("retries", 0) < MAX_RETRIES:
            return "generate"
        else:
            return "fail"
    return "execute"


async def fail_node(state: TextToSQLState) -> dict[str, Any]:
    """Terminal node for failed validation after max retries."""
    error_msg = f"Failed to generate valid SQL after {MAX_RETRIES} attempts. Last error: {state.get('validation_error')}"
    await _publish_progress(state, "error", {"message": error_msg})
    return {"error": error_msg, "answer": error_msg}


def build_text_to_sql_graph() -> Any:
    """Build and compile the text-to-SQL LangGraph StateGraph."""
    graph = StateGraph(TextToSQLState)

    # Add nodes
    graph.add_node("plan", plan_node)
    graph.add_node("generate", generate_node)
    graph.add_node("validate", validate_node)
    graph.add_node("execute", execute_node)
    graph.add_node("format", format_node)
    graph.add_node("fail", fail_node)

    # Set entry point
    graph.set_entry_point("plan")

    # Add edges
    graph.add_edge("plan", "generate")
    graph.add_edge("generate", "validate")

    # Conditional routing after validate
    graph.add_conditional_edges(
        "validate",
        should_retry_or_fail,
        {
            "generate": "generate",
            "execute": "execute",
            "fail": "fail",
        },
    )

    graph.add_edge("execute", "format")
    graph.add_edge("format", END)
    graph.add_edge("fail", END)

    return graph.compile()
