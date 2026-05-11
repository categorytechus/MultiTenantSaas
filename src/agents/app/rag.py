"""pgvector retrieval for RAG — RLS must already be set on the connection."""
import json

import psycopg

_SUPER_ADMIN = "super_admin"


async def retrieve_chunks(
    conn: psycopg.AsyncConnection,
    query_vector: list[float],
    top_k: int = 5,
    user_role: str = "",
) -> list[dict]:
    """Return the top-k most similar document chunks for the given query vector.

    Relies on the caller having already set app.current_org_id on the connection
    so that the RLS policy on document_chunks filters to the correct tenant.

    Role filtering (tags.roles is a JSONB array of permitted role names):
    - super_admin : unrestricted — sees all ready documents.
    - everyone else: only chunks whose document either has no roles restriction
      (null / empty array) or whose roles array contains the user's role.
    """
    if user_role.lower() == _SUPER_ADMIN:
        cur = await conn.execute(
            """
            SELECT dc.content,
                   d.filename,
                   1 - (dc.embedding <=> %s::vector) AS score
            FROM   document_chunks dc
            JOIN   documents d ON d.id = dc.document_id
            WHERE  d.status = 'ready'
            ORDER  BY dc.embedding <=> %s::vector
            LIMIT  %s
            """,
            [query_vector, query_vector, top_k],
        )
    else:
        # Build a single-element JSONB array for the containment check.
        # tags->'roles' @> '["role_name"]' is true when the roles array
        # contains the user's role.
        role_jsonb = json.dumps([user_role])
        cur = await conn.execute(
            """
            SELECT dc.content,
                   d.filename,
                   1 - (dc.embedding <=> %s::vector) AS score
            FROM   document_chunks dc
            JOIN   documents d ON d.id = dc.document_id
            WHERE  d.status = 'ready'
              AND (
                d.tags IS NULL
                OR d.tags->'roles' IS NULL
                OR d.tags->'roles' = '[]'::jsonb
                OR d.tags->'roles' @> %s::jsonb
              )
            ORDER  BY dc.embedding <=> %s::vector
            LIMIT  %s
            """,
            [query_vector, role_jsonb, query_vector, top_k],
        )

    return [
        {"content": row[0], "filename": row[1], "score": float(row[2])}
        for row in await cur.fetchall()
    ]
