from typing import Protocol, Any
import boto3
import asyncio
from botocore.exceptions import ClientError
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

class EmailProvider(Protocol):
    async def send_email(self, to: str, subject: str, html_content: str, from_name: str | None = None, from_email: str | None = None, reply_to: str | None = None) -> None:
        ...


class AwsSesEmailProvider:
    def __init__(self, from_email: str):
        self.from_email = from_email
        # boto3 automatically uses IAM roles if running on AWS EC2/ECS/EKS
        # or falls back to AWS_ACCESS_KEY_ID in env or ~/.aws/credentials
        kwargs = {'region_name': settings.S3_REGION}
        if settings.AWS_ACCESS_KEY_ID:
            kwargs['aws_access_key_id'] = settings.AWS_ACCESS_KEY_ID
            kwargs['aws_secret_access_key'] = settings.AWS_SECRET_ACCESS_KEY
        if settings.AWS_SESSION_TOKEN:
            kwargs['aws_session_token'] = settings.AWS_SESSION_TOKEN

        self.client = boto3.client('ses', **kwargs)

    async def send_email(self, to: str, subject: str, html_content: str, from_name: str | None = None, from_email: str | None = None, reply_to: str | None = None) -> None:
        primary_source = self.from_email
        if from_email:
            primary_source = f"{from_name} <{from_email}>" if from_name else from_email
        elif from_name:
            primary_source = f"{from_name} <{self.from_email}>"

        fallback_source = f"{from_name} <{self.from_email}>" if from_name else self.from_email
        
        kwargs = {
            'Destination': {'ToAddresses': [to]},
            'Message': {
                'Subject': {'Data': subject, 'Charset': 'UTF-8'},
                'Body': {'Html': {'Data': html_content, 'Charset': 'UTF-8'}}
            }
        }
        if reply_to:
            kwargs['ReplyToAddresses'] = [reply_to]

        try:
            logger.info(f"Sending email to {to} via AWS SES. Subject: {subject}. Source: {primary_source}")
            await asyncio.to_thread(self.client.send_email, Source=primary_source, **kwargs)
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') == 'MessageRejected' and from_email and from_email != self.from_email:
                logger.warning(f"Failed to send email via AWS SES with unverified custom domain {from_email}. Falling back to default {self.from_email}.")
                try:
                    await asyncio.to_thread(self.client.send_email, Source=fallback_source, **kwargs)
                except Exception as ex:
                    logger.error(f"Fallback failed to send email to {to}: {ex}", exc_info=True)
            else:
                logger.error(f"Failed to send email via AWS SES to {to}: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"Unexpected error sending email to {to}: {e}", exc_info=True)


class MockEmailProvider:
    """Used for testing or when no email provider is configured."""
    async def send_email(self, to: str, subject: str, html_content: str, from_name: str | None = None, from_email: str | None = None, reply_to: str | None = None) -> None:
        logger.info(f"[MOCK EMAIL] To: {to} | Subject: {subject} | From Name: {from_name} | From Email: {from_email} | Reply-To: {reply_to}")


def get_email_provider() -> EmailProvider:
    if settings.ENABLE_EMAILS:
        return AwsSesEmailProvider(from_email=settings.EMAIL_FROM)
    return MockEmailProvider()
