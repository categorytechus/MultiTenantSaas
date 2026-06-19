from typing import Protocol, Any
import boto3
import asyncio
from botocore.exceptions import ClientError
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

class EmailProvider(Protocol):
    async def send_email(self, to: str, subject: str, html_content: str) -> None:
        ...


class AwsSesEmailProvider:
    def __init__(self, from_email: str):
        self.from_email = from_email
        # boto3 automatically uses IAM roles if running on AWS EC2/ECS/EKS
        # or falls back to AWS_ACCESS_KEY_ID in env or ~/.aws/credentials
        self.client = boto3.client('ses', region_name=settings.S3_REGION)

    async def send_email(self, to: str, subject: str, html_content: str) -> None:
        try:
            logger.info(f"Sending email to {to} via AWS SES. Subject: {subject}")
            
            # boto3 is synchronous, so we run it in a threadpool to avoid blocking the event loop
            await asyncio.to_thread(
                self.client.send_email,
                Source=self.from_email,
                Destination={
                    'ToAddresses': [to]
                },
                Message={
                    'Subject': {
                        'Data': subject,
                        'Charset': 'UTF-8'
                    },
                    'Body': {
                        'Html': {
                            'Data': html_content,
                            'Charset': 'UTF-8'
                        }
                    }
                }
            )
        except ClientError as e:
            logger.error(f"Failed to send email via AWS SES to {to}: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"Unexpected error sending email to {to}: {e}", exc_info=True)


class MockEmailProvider:
    """Used for testing or when no email provider is configured."""
    async def send_email(self, to: str, subject: str, html_content: str) -> None:
        logger.info(f"[MOCK EMAIL] To: {to} | Subject: {subject}")


def get_email_provider() -> EmailProvider:
    if settings.ENABLE_EMAILS:
        return AwsSesEmailProvider(from_email=settings.EMAIL_FROM)
    return MockEmailProvider()
