"""Local embeddings via fastembed — 384-dim, matches document_chunks.embedding column."""
import asyncio

from fastembed import TextEmbedding
from app.config import settings

MODEL_NAME = settings.EMBEDDING_MODEL
DIMS = 384

_model: TextEmbedding | None = None


def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        _model = TextEmbedding(MODEL_NAME)
    return _model


def _embed_sync(texts: list[str]) -> list[list[float]]:
    return [list(v) for v in _get_model().embed(texts)]


async def embed_batch(texts: list[str]) -> list[list[float]]:
    return await asyncio.to_thread(_embed_sync, texts)


async def embed_query(text: str) -> list[float]:
    results = await embed_batch([text])
    return results[0]
