"""S3 / local filesystem storage — mirrors src/server/app/integrations/s3.py."""
from pathlib import Path
from typing import Any

import aiofiles
import boto3

from app.config import settings


def _local(key: str) -> Path:
    return Path(settings.LOCAL_UPLOAD_DIR) / key.lstrip("/")


def _client():
    kwargs: dict[str, Any] = {"region_name": settings.S3_REGION}
    if settings.AWS_ACCESS_KEY_ID:
        kwargs["aws_access_key_id"] = settings.AWS_ACCESS_KEY_ID
    if settings.AWS_SECRET_ACCESS_KEY:
        kwargs["aws_secret_access_key"] = settings.AWS_SECRET_ACCESS_KEY
    return boto3.client("s3", **kwargs)


async def download(key: str) -> bytes:
    if not settings.S3_BUCKET:
        async with aiofiles.open(_local(key), "rb") as f:
            return await f.read()
    return _client().get_object(Bucket=settings.S3_BUCKET, Key=key)["Body"].read()
