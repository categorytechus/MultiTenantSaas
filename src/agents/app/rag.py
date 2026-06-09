"""pgvector retrieval for RAG — RLS must already be set on the connection."""
import json

import psycopg

_SUPER_ADMIN = "super_admin"
_TEXT_TOP_K = 5    # max text chunks to retrieve
_IMAGE_TOP_K = 5   # max image chunks to always include alongside text


async def retrieve_chunks(
    conn: psycopg.AsyncConnection,
    query_vector: list[float],
    top_k: int = _TEXT_TOP_K,
    user_role: str = "",
) -> list[dict]:
    """Return the top-k most similar document chunks for the given query vector.

    Text chunks are ranked by vector similarity.
    Image chunks are always appended (up to _IMAGE_TOP_K) so they surface
    regardless of how text-focused the query is.

    Relies on the caller having already set app.current_org_id on the connection
    so that the RLS policy on document_chunks filters to the correct tenant.

    Role filtering (tags.roles is a JSONB array of permitted role names):
    - super_admin : unrestricted — sees all ready documents.
    - everyone else: only chunks whose document either has no roles restriction
      (null / empty array) or whose roles array contains the user's role.
    """
    role_filter_sql = ""
    role_params: list = []

    if user_role.lower() != _SUPER_ADMIN:
        role_jsonb = json.dumps([user_role])
        role_filter_sql = """
              AND (
                d.tags IS NULL
                OR d.tags->'roles' IS NULL
                OR d.tags->'roles' = '[]'::jsonb
                OR d.tags->'roles' @> %s::jsonb
              )"""
        role_params = [role_jsonb]

    # ── Text chunks (vector similarity ranked) ─────────────────────────────────
    text_sql = f"""
        SELECT dc.content,
               d.filename,
               1 - (dc.embedding <=> %s::vector) AS score,
               dc.chunk_type,
               dc.image_id,
               dc.document_id
        FROM   document_chunks dc
        JOIN   documents d ON d.id = dc.document_id
        WHERE  d.status = 'ready'
          AND  dc.chunk_type != 'image'
          {role_filter_sql}
        ORDER  BY dc.embedding <=> %s::vector
        LIMIT  %s
    """
    text_params = [query_vector] + role_params + [query_vector, top_k]
    text_cur = await conn.execute(text_sql, text_params)
    text_rows = await text_cur.fetchall()

    # ── Image chunks (always include, ranked by similarity, deduplicated by hash) ──
    # DISTINCT ON (di.content_hash) keeps only the highest-similarity instance of each unique image
    # Use subquery: inner query deduplicates, outer query sorts by similarity and limits
    image_sql = f"""
        SELECT * FROM (
            SELECT DISTINCT ON (di.content_hash)
                   dc.content,
                   d.filename,
                   1 - (dc.embedding <=> %s::vector) AS score,
                   dc.chunk_type,
                   dc.image_id,
                   dc.document_id
            FROM   document_chunks dc
            JOIN   documents d ON d.id = dc.document_id
            LEFT JOIN document_images di ON di.id = dc.image_id
            WHERE  d.status = 'ready'
              AND  dc.chunk_type = 'image'
              {role_filter_sql}
            ORDER  BY di.content_hash, (dc.embedding <=> %s::vector) ASC
        ) AS deduplicated
        ORDER BY score DESC
        LIMIT %s
    """
    image_params = [query_vector] + role_params + [query_vector, _IMAGE_TOP_K]
    image_cur = await conn.execute(image_sql, image_params)
    image_rows = await image_cur.fetchall()

    def _row_to_dict(row) -> dict:
        return {
            "content": row[0],
            "filename": row[1],
            "score": float(row[2]),
            "chunk_type": row[3],
            "image_id": str(row[4]) if row[4] else None,
            "document_id": str(row[5]) if row[5] else None,
        }

    return [_row_to_dict(r) for r in text_rows] + [_row_to_dict(r) for r in image_rows]
