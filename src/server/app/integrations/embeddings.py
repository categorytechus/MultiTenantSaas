from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger
from fastembed import TextEmbedding

logger = get_logger(__name__)

EMBEDDING_MODEL = settings.EMBEDDING_MODEL
EMBEDDING_DIMS = 384
BATCH_SIZE = 64

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="embeddings")


@lru_cache(maxsize=1)
def _get_model() -> Any:
    logger.info("Loading embedding model", model=EMBEDDING_MODEL)
    return TextEmbedding(EMBEDDING_MODEL)


def _encode(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    return [emb.tolist() for emb in model.embed(texts)]


async def embed(text: str) -> list[float]:
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(_executor, _encode, [text])
    return results[0]


async def embed_batch(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    loop = asyncio.get_event_loop()
    results: list[list[float]] = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        batch_results = await loop.run_in_executor(_executor, _encode, batch)
        results.extend(batch_results)
    return results
