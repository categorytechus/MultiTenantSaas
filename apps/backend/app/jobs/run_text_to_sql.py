import asyncio
from typing import Any

from app.core.db import db_session
from app.core.logging import get_logger
from app.core.redis import publish, task_channel
from app.models.agent_task import AgentTaskStatus
from app.services.agent_tasks import update_task_status
from app.agents.graphs.text_to_sql import build_text_to_sql_graph
from datetime import datetime, timezone

logger = get_logger(__name__)

RETRY_DELAYS = [2, 8, 32]


async def run_text_to_sql(
    ctx: dict[str, Any],
    task_id: str,
    org_id: str,
    user_id: str,
    question: str,
) -> dict[str, Any]:
    """
    Arq job: Run the text-to-SQL LangGraph agent.
    Publishes progress to Redis Pub/Sub.
    """
    job_try = ctx.get("job_try", 1)
    logger.info("Starting text-to-SQL job", task_id=task_id, org_id=org_id, attempt=job_try)

    channel = task_channel(org_id, task_id)

    async with db_session(org_id) as session:
        try:
            # Mark task as running
            await update_task_status(session, task_id, AgentTaskStatus.RUNNING)

            # Build and run the LangGraph
            graph = build_text_to_sql_graph()
            result = await graph.ainvoke({
                "question": question,
                "org_id": org_id,
                "user_id": user_id,
                "session": session,
                "task_id": task_id,
                "tables": [],
                "sql": "",
                "result": {},
                "answer": "",
                "retries": 0,
                "error": None,
                "validation_error": None,
            })

            # Check if there was an error
            if result.get("error"):
                await update_task_status(
                    session,
                    task_id,
                    AgentTaskStatus.FAILED,
                    error=result["error"],
                )
                await publish(channel, {
                    "type": "error",
                    "data": {"message": result["error"]},
                    "ts": datetime.now(timezone.utc).isoformat(),
                })
                return {"status": "failed", "error": result["error"]}

            # Success
            output = {
                "answer": result.get("answer", ""),
                "sql": result.get("sql", ""),
                "result": result.get("result", {}),
            }
            await update_task_status(
                session,
                task_id,
                AgentTaskStatus.SUCCEEDED,
                output=output,
            )

            logger.info("Text-to-SQL job completed", task_id=task_id)
            return {"status": "success", "task_id": task_id, **output}

        except Exception as e:
            logger.error("Text-to-SQL job failed", task_id=task_id, error=str(e), attempt=job_try)

            try:
                await update_task_status(
                    session,
                    task_id,
                    AgentTaskStatus.FAILED,
                    error=str(e),
                )
                await publish(channel, {
                    "type": "error",
                    "data": {"message": str(e)},
                    "ts": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as inner_e:
                logger.error("Failed to update task status", error=str(inner_e))

            # Delay before retry
            if job_try < len(RETRY_DELAYS) + 1:
                delay = RETRY_DELAYS[min(job_try - 1, len(RETRY_DELAYS) - 1)]
                logger.info("Retrying text-to-SQL", task_id=task_id, delay=delay)
                await asyncio.sleep(delay)

            raise


# Configure retry settings
run_text_to_sql.retry = 3  # type: ignore[attr-defined]
