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

async def send_payment_success_email(to_email: str, amount: float, project_name: str) -> None:
    subject = f"Payment Successful: {project_name}"
    html = _render_template(
        "payment_success.html", 
        amount=f"${amount:.2f}", 
        project_name=project_name
    )
    provider = get_email_provider()
    await provider.send_email(to_email, subject, html)

async def send_payment_failed_email(to_email: str, project_name: str) -> None:
    subject = f"Payment Action Required: {project_name}"
    html = _render_template("payment_failed.html", project_name=project_name)
    provider = get_email_provider()
    await provider.send_email(to_email, subject, html)

async def send_report_ready_email(to_email: str, project_name: str, report_url: str) -> None:
    subject = f"Your Report is Ready: {project_name}"
    html = _render_template(
        "report_ready.html", 
        project_name=project_name, 
        report_url=report_url
    )
    provider = get_email_provider()
    await provider.send_email(to_email, subject, html)

async def send_invite_email(to_email: str, org_name: str, invite_url: str) -> None:
    subject = f"You have been invited to join {org_name}"
    html = _render_template(
        "invite.html", 
        org_name=org_name, 
        invite_url=invite_url
    )
    provider = get_email_provider()
    await provider.send_email(to_email, subject, html)
