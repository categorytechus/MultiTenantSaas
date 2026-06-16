import stripe
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from typing import Any
from uuid import UUID

from app.core.config import settings
from app.core.db import db_session, async_session_factory
from app.core.logging import get_logger
from app.models.agent_task import AgentTask, AgentTaskType
from app.models.workflow import WorkflowSession
from app.services import cost_seg as svc
from app.services.agent_tasks import create_task

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])
logger = get_logger(__name__)


@router.post("/stripe")
async def stripe_webhook(request: Request) -> Any:
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except Exception as e:
        logger.error(f"Webhook signature verification failed: {e}")
        raise HTTPException(status_code=400, detail="Invalid signature or payload")

    event_type = event["type"]
    logger.info(f"Received stripe webhook event", event_type=event_type)

    if event_type != "checkout.session.completed":
        return {"status": "success"}

    session_data = event["data"]["object"]
    project_id_str = getattr(session_data, "client_reference_id", None)

    if not project_id_str:
        logger.warning("No client_reference_id found in checkout.session.completed — ignoring")
        return {"status": "success"}

    try:
        project_id = UUID(project_id_str)
    except ValueError:
        logger.error(f"Invalid project_id UUID", project_id_str=project_id_str)
        return {"status": "success"}

    logger.info(f"Processing checkout.session.completed", project_id=str(project_id))

    # ── Step 1: Look up org_id from project (no RLS) ──────────────────────────
    # Stripe has no JWT, so we use a raw session without RLS context to find
    # which org owns this project. This is safe — we only read org_id/user_id.
    try:
        async with async_session_factory() as raw_session:
            async with raw_session.begin():
                result = await raw_session.execute(
                    select(WorkflowSession.org_id, WorkflowSession.user_id).where(
                        WorkflowSession.id == project_id
                    )
                )
                row = result.one_or_none()
    except Exception as e:
        logger.error(f"Failed at Step 1 (project lookup)", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"Project lookup failed: {e}")

    if not row:
        logger.error(f"Project not found in DB", project_id=str(project_id))
        return {"status": "success"}

    org_id, user_id = row[0], row[1]
    logger.info(f"Found project", org_id=str(org_id), user_id=str(user_id))

    # ── Step 2: Mark project as paid (with RLS) ──────────────────────────────
    try:
        async with db_session(org_id) as sess:
            project = await svc.get_project(sess, project_id)
            if project.status != "paid":
                await svc.update_project(sess, project, status="paid")
                logger.info(f"Project marked as PAID", project_id=str(project_id))
            else:
                logger.info(f"Project was already paid", project_id=str(project_id))

            # ── Step 3: Check for existing report task ────────────────────────
            existing_tasks_result = await sess.execute(
                select(AgentTask).where(
                    AgentTask.org_id == org_id,
                    AgentTask.type == "cost_seg_report",
                )
            )
            existing_tasks = existing_tasks_result.scalars().all()
            existing_task = next(
                (
                    t
                    for t in existing_tasks
                    if t.input and t.input.get("project_id") == str(project_id)
                ),
                None,
            )

            if existing_task and existing_task.status in ("pending", "running", "succeeded"):
                logger.info(
                    f"Report task already exists — skipping", 
                    task_id=str(existing_task.id), 
                    status=existing_task.status
                )
                return {"status": "success"}

            # ── Step 4: Create task record ────────────────────────────────────
            task = await create_task(
                sess,
                org_id=org_id,
                user_id=user_id,
                task_type=AgentTaskType.COST_SEG_REPORT,
                input_data={"project_id": str(project_id)},
            )
            logger.info(f"Created AgentTask", task_id=str(task.id))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed at Step 2-4 (DB operations)", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"DB operations failed: {e}")

    # ── Step 5: Enqueue run_report in Redis ───────────────────────────────────
    try:
        from arq.connections import create_pool, RedisSettings

        redis_conn = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        await redis_conn.enqueue_job(
            "run_report",
            task_id=str(task.id),
            org_id=str(org_id),
            project_id=str(project_id),
        )
        await redis_conn.aclose()
        logger.info(
            f"SUCCESS — run_report enqueued!",
            task_id=str(task.id),
            org_id=str(org_id),
            project_id=str(project_id)
        )
    except Exception as e:
        logger.error(f"Failed at Step 5 (Redis enqueue)", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"Redis enqueue failed: {e}")

    return {"status": "success"}
