from arq.connections import RedisSettings

from app.core.config import settings
from app.jobs.ingest_document import ingest_document
from app.jobs.run_text_to_sql import run_text_to_sql


class WorkerSettings:
    functions = [ingest_document, run_text_to_sql]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 10
    job_timeout = 300
    keep_result = 3600
