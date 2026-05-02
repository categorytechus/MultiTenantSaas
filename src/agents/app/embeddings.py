"""OpenAI embeddings — mirrors src/server/app/integrations/embeddings.py."""
import openai

from app.config import settings

MODEL = "text-embedding-3-small"
DIMS = 1536
BATCH = 64


def _zeros() -> list[float]:
    return [0.0] * DIMS


async def embed_batch(texts: list[str]) -> list[list[float]]:
    if not settings.OPENAI_API_KEY:
        return [_zeros() for _ in texts]

    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    results: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        resp = await client.embeddings.create(
            model=MODEL,
            input=texts[i : i + BATCH],
            encoding_format="float",
        )
        results.extend(item.embedding for item in sorted(resp.data, key=lambda x: x.index))
    return results
