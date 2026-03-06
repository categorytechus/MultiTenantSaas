const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://admin:admin@localhost:5432/multitenant_saas'
});

/**
 * Executes a database query.
 */
const query = (text, params) => pool.query(text, params);

/**
 * Helper to check permissions in DB.
 */
const checkPermission = async (userId, orgId, resource, action) => {
    const sql = `
        SELECT EXISTS(
            SELECT 1
            FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = $1
            AND ur.organization_id = $2
            AND p.resource = $3
            AND p.action = $4
        ) as has_perm;
    `;
    const result = await query(sql, [userId, orgId, resource, action]);
    return result.rows[0].has_perm;
};

/**
 * Helper to discover knowledge base resources for a user.
 */
const discoverResources = async (userId, orgId) => {
    const sql = `
        SELECT id, name, type, content_path, text_context, tags
        FROM knowledge_base_resources
        WHERE organization_id = $1
        AND (
            role_id IS NULL OR 
            role_id IN (
                SELECT ur.role_id 
                FROM user_roles ur 
                WHERE ur.user_id = $2 
                AND ur.organization_id = $1
            )
        );
    `;
    const result = await query(sql, [orgId, userId]);
    return result.rows;
};

/**
 * Helper to create a task record in the DB immediately.
 */
const createTask = async (orgId, userId, prompt, resources, action, sessionId) => {
    const sql = `
        INSERT INTO agent_tasks (organization_id, user_id, agent_type, status, input_data, session_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id;
    `;
    const inputData = JSON.stringify({ prompt, resources, action });
    const result = await query(sql, [orgId, userId, 'orchestrator', 'pending', inputData, sessionId || null]);
    return result.rows[0].id;
};

/**
 * Helper to fetch task status and result.
 */
const getTaskStatus = async (taskId, orgId) => {
    const sql = `
        SELECT t.id, t.status, t.created_at, t.completed_at, r.result_data
        FROM agent_tasks t
        LEFT JOIN agent_results r ON t.id = r.task_id
        WHERE t.id = $1 AND t.organization_id = $2;
    `;
    const result = await query(sql, [taskId, orgId]);
    return result.rows[0];
};

module.exports = {
    query,
    checkPermission,
    discoverResources,
    createTask,
    getTaskStatus
};
