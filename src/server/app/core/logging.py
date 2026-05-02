import logging
import sys
from typing import Any

import structlog
from structlog.types import EventDict, Processor

from app.core.config import settings


def add_service_field(
    logger: logging.Logger, method: str, event_dict: EventDict
) -> EventDict:
    event_dict["service"] = settings.SERVICE_NAME
    return event_dict


def add_log_level(
    logger: logging.Logger, method: str, event_dict: EventDict
) -> EventDict:
    event_dict["level"] = method.upper()
    return event_dict


def setup_logging() -> None:
    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        add_service_field,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    if settings.ENVIRONMENT == "development":
        # Pretty console output for dev
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(),
        ]
    else:
        # JSON output for production
        processors = shared_processors + [
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(logging.DEBUG),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )

    # Also configure stdlib logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=logging.INFO,
    )


def get_logger(name: str = __name__) -> Any:
    return structlog.get_logger(name)


def bind_request_context(request_id: str, org_id: str | None = None, user_id: str | None = None) -> None:
    """Bind request-scoped context variables to structlog."""
    ctx: dict[str, Any] = {"request_id": request_id}
    if org_id is not None:
        ctx["org_id"] = org_id
    if user_id is not None:
        ctx["user_id"] = user_id
    structlog.contextvars.bind_contextvars(**ctx)


def clear_request_context() -> None:
    """Clear request-scoped context variables."""
    structlog.contextvars.clear_contextvars()
