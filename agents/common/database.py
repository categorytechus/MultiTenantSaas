import os
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
import logging

logger = logging.getLogger(__name__)

@contextmanager
def get_db_connection():
    """Provides a transactional scope around a series of operations."""
    # Use separate components to avoid URL parsing issues with special characters in passwords
    conn = psycopg2.connect(
        host=os.getenv('DB_HOST', 'postgres'),
        database=os.getenv('DB_NAME', 'multitenant_saas'),
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', 'postgres'),
        port=os.getenv('DB_PORT', '5432')
    )
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Database error: {e}")
        raise
    finally:
        conn.close()

@contextmanager
def get_db_cursor(cursor_factory=None):
    """Provides a database cursor within a connection context."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=cursor_factory) as cur:
            yield cur

def fetch_allowed_asset_ids(user_id: str):
    """
    Unified method to fetch allowed asset IDs from the rbac_permissions table.
    """
    query = """
        SELECT DISTINCT asset_id
        FROM rbac_permissions
        WHERE (user_id = %s OR owner_id = %s)
        AND (permission IN ('read', 'write', 'admin') OR owner_id = %s)
    """
    try:
        with get_db_cursor() as cur:
            cur.execute(query, (user_id, user_id, user_id))
            return [str(row[0]) for row in cur.fetchall()]
    except Exception as e:
        logger.error(f"Error fetching allowed asset IDs: {e}")
        return []

def update_task_status(task_id: str, status: str, result: dict = None):
    """
    Unified method to update task status.

    Result payloads belong in agent_results, not agent_tasks.
    """
    if status == 'running':
        query = "UPDATE agent_tasks SET status = %s, started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = %s"
        params = (status, task_id)
    elif status == 'completed':
        query = "UPDATE agent_tasks SET status = %s, completed_at = NOW(), updated_at = NOW() WHERE id = %s"
        params = (status, task_id)
    elif status == 'failed':
        query = "UPDATE agent_tasks SET status = %s, failed_at = NOW(), updated_at = NOW() WHERE id = %s"
        params = (status, task_id)
    else:
        query = "UPDATE agent_tasks SET status = %s, updated_at = NOW() WHERE id = %s"
        params = (status, task_id)

    try:
        with get_db_cursor() as cur:
            cur.execute(query, params)
    except Exception as e:
        logger.error(f"Error updating task status: {e}")
