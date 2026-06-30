import stripe
from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from sqlalchemy import select
from typing import Any
from uuid import UUID

from app.core.config import settings
from app.core.db import db_session, async_session_factory
from app.core.logging import get_logger
from app.models.agent_task import AgentTask, AgentTaskType
from app.models.workflow import WorkflowSession
from app.models.user import User
from app.services import cost_seg as svc
from app.services.agent_tasks import create_task
from app.services.email.service import send_payment_success_email, send_payment_failed_email


router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])
logger = get_logger(__name__)


async def _handle_due_diligence_payment(
    project_id: UUID,
    event_type: str,
    session_data: dict,
    background_tasks: BackgroundTasks
) -> dict:
    """Handle successful checkout completions for due diligence studies."""
    from app.models.due_diligence import DueDiligenceStudy
    from sqlalchemy import select as sa_select
    from app.services import due_diligence as dd_svc
    
    try:
        async with async_session_factory() as raw_session:
            async with raw_session.begin():
                result = await raw_session.execute(
                    sa_select(DueDiligenceStudy.org_id, DueDiligenceStudy.user_id, DueDiligenceStudy.title)
                    .where(DueDiligenceStudy.id == project_id)
                )
                row = result.one_or_none()
    except Exception as e:
        logger.error(f"DD study lookup failed", error=str(e), exc_info=True)
        return {"status": "success"}

    if not row:
        logger.warning("DD study not found", study_id=str(project_id))
        return {"status": "success"}

    dd_org_id, _dd_user_id, _dd_title = row[0], row[1], row[2]
    
    if event_type == "checkout.session.async_payment_failed":
        # Additional logic for failed emails could be added here if needed
        return {"status": "success"}
        
    try:
        from arq.connections import create_pool, RedisSettings
        from app.models.agent_task import AgentTaskType
        from app.services.agent_tasks import create_task

        async with db_session(dd_org_id) as sess:
            study = await dd_svc.get_study(sess, project_id)
            if study.status != "paid":
                await dd_svc.update_study(sess, study, status="paid")
                logger.info("DD study marked as PAID", study_id=str(project_id))
            
            if not _dd_user_id:
                from sqlalchemy import select as sa_select
                from app.models.org import OrgMembership
                membership_result = await sess.execute(
                    sa_select(OrgMembership.user_id).where(OrgMembership.org_id == dd_org_id).limit(1)
                )
                _dd_user_id = membership_result.scalar()
                
            if not _dd_user_id:
                raise ValueError("No user found in org to assign task to")

            from app.models.agent_task import AgentTask, AgentTaskType
            from sqlalchemy import select as sa_select
            
            # Check for existing report task to avoid duplicates
            existing_task = await sess.execute(
                sa_select(AgentTask).where(
                    AgentTask.org_id == dd_org_id,
                    AgentTask.type == AgentTaskType.DUE_DILIGENCE_REPORT.value,
                    AgentTask.status.in_(["pending", "running"]),
                    AgentTask.input["study_id"].as_string() == str(project_id)
                )
            )
            if existing_task.scalars().first():
                logger.info("DD Report task already exists — skipping webhook enqueue", study_id=str(project_id))
                return {"status": "success"}

            # Enqueue report generation task
            task = await create_task(
                sess,
                org_id=dd_org_id,
                user_id=_dd_user_id,
                task_type=AgentTaskType.DUE_DILIGENCE_REPORT,
                input_data={"study_id": str(project_id)},
            )
            
        redis_conn = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        await redis_conn.enqueue_job(
            "run_due_diligence_report",
            _job_id=f"dd_report_{project_id}",
            task_id=str(task.id),
            org_id=str(dd_org_id),
            study_id=str(project_id),
        )
        await redis_conn.aclose()
        logger.info("Enqueued run_due_diligence_report", task_id=str(task.id), study_id=str(project_id))

    except Exception as e:
        logger.error(f"Failed to process DD payment and enqueue report", error=str(e), exc_info=True)
        
    return {"status": "success"}


async def _handle_cost_seg_payment(
    project_id: UUID,
    event_type: str,
    session_data: dict,
    background_tasks: BackgroundTasks
) -> dict:
    """Handle checkout events for cost segregation projects."""
    # ── Step 1: Look up org_id, user_id, and user email from project (cost seg) ─
    # Stripe has no JWT, so we use a raw session without RLS context to find
    # which org owns this project. This is safe — we only read org_id/user_id.
    try:
        async with async_session_factory() as raw_session:
            async with raw_session.begin():
                result = await raw_session.execute(
                    select(WorkflowSession.org_id, WorkflowSession.user_id, WorkflowSession.title, User.email)
                    .outerjoin(User, WorkflowSession.user_id == User.id)
                    .where(WorkflowSession.id == project_id)
                )
                row = result.one_or_none()
    except Exception as e:
        logger.error(f"Failed at Step 1 (project lookup)", error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"Project lookup failed: {e}")

    if not row:
        logger.error(f"Project not found in DB", project_id=str(project_id))
        return {"status": "success"}

    org_id, user_id, project_title, user_email = row[0], row[1], row[2], row[3]
    logger.info(f"Found project", org_id=str(org_id), user_id=str(user_id))

    if event_type == "checkout.session.async_payment_failed":
        if user_email:
            background_tasks.add_task(send_payment_failed_email, user_email, org_id, project_title)
        return {"status": "success"}

    # ── Step 2: Mark project as paid (with RLS) ──────────────────────────────
    try:
        async with db_session(org_id) as sess:
            project = await svc.get_project(sess, project_id)
            if project.status != "paid":
                await svc.update_project(sess, project, status="paid")
                logger.info(f"Project marked as PAID", project_id=str(project_id))
                
                if user_email:
                    amount = getattr(session_data, "amount_total", session_data.get("amount_total", 0)) / 100.0
                    background_tasks.add_task(send_payment_success_email, user_email, org_id, amount, project_title)
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


@router.post("/stripe")
async def stripe_webhook(request: Request, background_tasks: BackgroundTasks) -> Any:
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

    if event_type not in ("checkout.session.completed", "checkout.session.async_payment_failed"):
        return {"status": "success"}

    session_data = event["data"]["object"]
    
    # Use standard dict .get() since session_data is a dict-like stripe object
    project_id_str = getattr(session_data, "client_reference_id", None)
    if not project_id_str:
        project_id_str = session_data.get("client_reference_id")

    if not project_id_str:
        logger.warning("No client_reference_id found in checkout session — ignoring")
        return {"status": "success"}

    try:
        project_id = UUID(project_id_str)
    except ValueError:
        logger.error(f"Invalid project_id UUID", project_id_str=project_id_str)
        return {"status": "success"}

    logger.info(f"Processing checkout event", event_type=event_type, project_id=str(project_id))

    # ── Detect if this is a due diligence checkout or cost seg ─────────────────
    session_metadata = getattr(session_data, "metadata", None)
    if session_metadata is None and isinstance(session_data, dict):
        session_metadata = session_data.get("metadata")
    session_metadata = session_metadata or {}
    
    study_type = getattr(session_metadata, "study_type", None)
    if study_type is None and hasattr(session_metadata, "get"):
        study_type = session_metadata.get("study_type")
        
    is_due_diligence = study_type == "due_diligence"

    if is_due_diligence:
        return await _handle_due_diligence_payment(project_id, event_type, session_data, background_tasks)
    else:
        return await _handle_cost_seg_payment(project_id, event_type, session_data, background_tasks)
