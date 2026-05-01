from typing import List

import openai

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMS = 1536
BATCH_SIZE = 64


def _zero_vector() -> list[float]:
    """Return a zero vector for dev/test when OpenAI key is not set."""
    return [0.0] * EMBEDDING_DIMS


async def embed(text: str) -> list[float]:
    """
    Embed a single text string using OpenAI text-embedding-3-small.
    Returns a zero vector if OPENAI_API_KEY is not set.
    """
    if not settings.OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY not set, returning zero vector")
        return _zero_vector()

    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    response = await client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text,
        encoding_format="float",
    )
    return response.data[0].embedding


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """
    Embed a batch of texts using OpenAI.
    Processes in chunks of BATCH_SIZE.
    Returns zero vectors if OPENAI_API_KEY is not set.
    """
    if not settings.OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY not set, returning zero vectors")
        return [_zero_vector() for _ in texts]

    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    results: list[list[float]] = []

    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        response = await client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=batch,
            encoding_format="float",
        )
        # Preserve order (OpenAI returns them in order)
        batch_results = sorted(response.data, key=lambda x: x.index)
        results.extend([item.embedding for item in batch_results])

    return results
