import os
from jinja2 import Environment, FileSystemLoader, select_autoescape
from app.services.email.provider import get_email_provider
from app.core.logging import get_logger

logger = get_logger(__name__)

# Setup Jinja2 environment
template_dir = os.path.join(os.path.dirname(__file__), "..", "..", "templates", "email")
env = Environment(
    loader=FileSystemLoader(template_dir),
    autoescape=select_autoescape(['html', 'xml'])
)

def _render_template(template_name: str, **kwargs) -> str:
    template = env.get_template(template_name)
    return template.render(**kwargs)

from uuid import UUID
from app.core.db import db_session
from app.models.org import Org

async def _get_org_email_settings(org_id: UUID | str) -> tuple[str, str | None, str | None]:
    async with db_session(org_id) as session:
        org = await session.get(Org, org_id)
        if not org:
            logger.warning(f"Org {org_id} not found for email settings")
            return ("Kolmio", None, None)
        return (org.name, org.email_from, org.email_reply_to)


async def send_payment_success_email(to_email: str, org_id: UUID | str, amount: float, project_name: str) -> None:
    org_name, from_email, reply_to = await _get_org_email_settings(org_id)
    subject = f"Payment Successful: {project_name}"
    html = _render_template(
        "payment_success.html", 
        amount=f"${amount:.2f}", 
        project_name=project_name
    )
    provider = get_email_provider()
    await provider.send_email(to_email, subject, html, from_name=org_name, from_email=from_email, reply_to=reply_to)

async def send_payment_failed_email(to_email: str, org_id: UUID | str, project_name: str) -> None:
    org_name, from_email, reply_to = await _get_org_email_settings(org_id)
    subject = f"Payment Action Required: {project_name}"
    html = _render_template("payment_failed.html", project_name=project_name)
    provider = get_email_provider()
    await provider.send_email(to_email, subject, html, from_name=org_name, from_email=from_email, reply_to=reply_to)

async def send_report_ready_email(to_email: str, org_id: UUID | str, project_name: str, report_url: str) -> None:
    org_name, from_email, reply_to = await _get_org_email_settings(org_id)
    subject = f"Your Report is Ready: {project_name}"
    html = _render_template(
        "report_ready.html", 
        project_name=project_name, 
        report_url=report_url
    )
    provider = get_email_provider()
    await provider.send_email(to_email, subject, html, from_name=org_name, from_email=from_email, reply_to=reply_to)

async def send_invite_email(to_email: str, org_id: UUID | str, invite_url: str) -> None:
    org_name, from_email, reply_to = await _get_org_email_settings(org_id)
    subject = f"You have been invited to join {org_name}"
    html = _render_template(
        "invite.html", 
        org_name=org_name, 
        invite_url=invite_url
    )
    provider = get_email_provider()
    await provider.send_email(to_email, subject, html, from_name=org_name, from_email=from_email, reply_to=reply_to)


async def send_org_setup_success_email(to_email: str, org_name: str, org_id: UUID | str) -> None:
    _, from_email, reply_to = await _get_org_email_settings(org_id)
    subject = f"{org_name} has been successfully setup"
    html = _render_template(
        "org_setup_success.html", 
        org_name=org_name
    )
    provider = get_email_provider()
    await provider.send_email(to_email, subject, html, from_name="System", from_email=from_email, reply_to=reply_to)


async def send_password_reset_success_email(to_email: str) -> None:
    subject = "Your password has been successfully reset"
    html = _render_template("password_reset_success.html")
    provider = get_email_provider()
    # No org context here, uses system defaults
    await provider.send_email(to_email, subject, html, from_name="System")
