const express = require('express');
const { hasPermission, getOrgId, buildContextFromHeaders } = require('./permissions');
const { publishMessage } = require('./utils/rabbitmq');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * Handles POST /api/validate-permissions
 * Accepts { "permission": "..." } or { "permissions": ["..."] }
 */
app.post('/api/validate-permissions', (req, res) => {
    const context = buildContextFromHeaders(req);
    const orgId = getOrgId(context);

    const parsed = req.body;
    const permissionsToCheck = parsed.permissions
        ? parsed.permissions
        : parsed.permission
            ? [parsed.permission]
            : [];

    if (permissionsToCheck.length === 0) {
        return res.status(400).json({
            error: 'Bad Request',
            message: 'Request body must include "permission" (string) or "permissions" (array).'
        });
    }

    const results = permissionsToCheck.map((perm) => ({
        permission: perm,
        granted: hasPermission(context, perm)
    }));

    const allGranted = results.every((r) => r.granted);
    console.log(`Permission validation for Org ${orgId}: ${JSON.stringify(results)}`);

    return res.status(200).json({
        org_id: orgId,
        principal: context.user_id || null,
        all_granted: allGranted,
        results
    });
});

/**
 * POST /api/agents -- requires agents:create
 */
app.post('/api/agents', async (req, res) => {
    await handleOrchestration(req, res, 'agents:create');
});

/**
 * POST /api/users -- requires users:manage
 */
app.post('/api/users', async (req, res) => {
    await handleOrchestration(req, res, 'users:manage');
});

/**
 * PUT /api/orgs -- requires org:manage
 */
app.put('/api/orgs', async (req, res) => {
    await handleOrchestration(req, res, 'org:manage');
});

/**
 * Core orchestration: check permission then publish to RabbitMQ.
 */
async function handleOrchestration(req, res, requiredPermission) {
    const context = buildContextFromHeaders(req);
    const orgId = getOrgId(context);

    if (!hasPermission(context, requiredPermission)) {
        console.warn(`Unauthorized: User ${context.user_id} lacks ${requiredPermission} for Org ${orgId}`);
        return res.status(403).json({
            error: 'Forbidden',
            message: `You do not have the required permission: ${requiredPermission}`
        });
    }

    console.log(`Permission granted for ${requiredPermission}. Publishing task for Org: ${orgId}`);

    try {
        await publishMessage('cmd.task.create', {
            org_id: orgId,
            action: requiredPermission,
            payload: req.body || {},
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            message: 'Orchestration request accepted',
            org_id: orgId,
            action: requiredPermission,
            status: 'QUEUED'
        });
    } catch (err) {
        console.error('Failed to publish to RabbitMQ:', err);
        return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to queue task'
        });
    }
}

app.get('/api/task-status/:taskId', (req, res) => {
    res.status(200).json({
        task_id: req.params.taskId,
        status: 'PENDING',
        message: 'Task status polling stub'
    });
});

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Orchestrator service listening on port ${PORT}`);
});
