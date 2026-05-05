import os
from pathlib import Path
from typing import Any

import aiofiles
import boto3
from botocore.exceptions import ClientError

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _is_local_mode() -> bool:
    """Return True if S3 is not configured (use local filesystem instead)."""
    return not settings.S3_BUCKET


def _local_path(key: str) -> Path:
    """Map an S3-style key to a local filesystem path."""
    # Strip leading slashes and ensure the path is safe
    safe_key = key.lstrip("/")
    return Path(settings.LOCAL_UPLOAD_DIR) / safe_key


def _get_s3_client():
    """Create a boto3 S3 client."""
    kwargs: dict[str, Any] = {"region_name": settings.S3_REGION}
    if settings.AWS_ACCESS_KEY_ID:
        kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
    if settings.AWS_SECRET_ACCESS_KEY:
        kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
    if settings.AWS_SESSION_TOKEN:
        kwargs["aws_session_token"] = settings.AWS_SESSION_TOKEN
    return boto3.client("s3", **kwargs)


async def upload(key: str, body: bytes, tags: dict[str, str] | None = None) -> None:
    """
    Upload an object to S3 or local filesystem.
    Falls back to LOCAL_UPLOAD_DIR if S3_BUCKET is empty.
    """
    if _is_local_mode():
        local_path = _local_path(key)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(local_path, "wb") as f:
            await f.write(body)
        logger.debug("Uploaded to local filesystem", key=key, path=str(local_path))
        return

    s3 = _get_s3_client()
    kwargs: dict[str, Any] = {
        "Bucket": settings.S3_BUCKET,
        "Key": key,
        "Body": body,
    }
    if tags:
        tag_str = "&".join(f"{k}={v}" for k, v in tags.items())
        kwargs["Tagging"] = tag_str

    s3.put_object(**kwargs)
    logger.debug("Uploaded to S3", bucket=settings.S3_BUCKET, key=key)


async def download(key: str) -> bytes:
    """
    Download an object from S3 or local filesystem.
    """
    if _is_local_mode():
        local_path = _local_path(key)
        async with aiofiles.open(local_path, "rb") as f:
            return await f.read()

    s3 = _get_s3_client()
    response = s3.get_object(Bucket=settings.S3_BUCKET, Key=key)
    return response["Body"].read()


async def delete(key: str) -> None:
    """
    Delete an object from S3 or local filesystem.
    """
    if _is_local_mode():
        local_path = _local_path(key)
        if local_path.exists():
            local_path.unlink()
        return

    s3 = _get_s3_client()
    try:
        s3.delete_object(Bucket=settings.S3_BUCKET, Key=key)
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            logger.warning("S3 object not found for deletion", key=key)
        else:
            raise


async def presigned_get(key: str, expires: int = 3600) -> str:
    """
    Generate a presigned URL for GET access to an S3 object.
    For local mode, returns a local file URL.
    """
    if _is_local_mode():
        local_path = _local_path(key)
        return f"file://{local_path}"

    s3 = _get_s3_client()
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key},
        ExpiresIn=expires,
    )
    return url


def make_s3_key(org_id: str, document_id: str, ext: str) -> str:
    """Generate the canonical S3 object key for a document."""
    ext = ext.lstrip(".")
    return f"orgs/{org_id}/documents/{document_id}/original.{ext}"
