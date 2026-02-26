const express = require('express');
const { verifyToken, createEnrichedToken } = require('./auth_util');
const { checkPermission, discoverResources, createTask, getTaskStatus } = require('./utils/db');
const { publishTask } = require('./utils/rabbitmq');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

/**
 * Helper to extract context from token
 */
const getContext = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    return verifyToken(token);
};

/**
 * Traefik ForwardAuth endpoint.
 */
app.get('/verify', (req, res) => {
    const decoded = getContext(req);

    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    res.set({
        'X-User-Id': decoded.sub,
        'X-Org-Id': decoded.org_id,
        'X-Permissions': JSON.stringify(decoded.permissions),
        'X-Email': decoded.email
    });

    return res.status(200).json({ status: 'authenticated' });
});

/**
 * Token creation endpoint.
 * Expects { user: { id, email }, org_id, permissions }.
 */
app.post('/token', (req, res) => {
    const { user, org_id, permissions } = req.body;

    if (!user?.id || !user?.email || !org_id || !Array.isArray(permissions)) {
        return res.status(400).json({
            error: 'Bad Request',
            message: 'Required: { user: { id, email }, org_id, permissions: [...] }'
        });
    }

    const token = createEnrichedToken(user, org_id, permissions);
    return res.status(200).json({ token });
});

/**
 * Common handler for all orchestrator-bound requests.
 */
async function handleRequest(req, res, targetResource, targetAction, inputData) {
    const decoded = getContext(req);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const userId = decoded.sub;
    const orgId = decoded.org_id;

    try {
        // 1. RBAC Validation
        const hasPerm = await checkPermission(userId, orgId, targetResource, targetAction);
        if (!hasPerm) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `You do not have permission to ${targetAction} ${targetResource}.`
            });
        }

        // 2. Resource Discovery
        const resources = await discoverResources(userId, orgId);

        // 3. Immediate Task Creation
        const taskId = await createTask(orgId, userId, inputData.prompt, resources, `${targetResource}:${targetAction}`);

        // 4. Publish to RabbitMQ with Task ID
        await publishTask({
            taskId,
            userId,
            orgId,
            action: `${targetResource}:${targetAction}`,
            prompt: inputData.prompt || `Action: ${targetAction} on ${targetResource}`,
            input: inputData,
            resources,
            timestamp: new Date().toISOString()
        });

        return res.status(202).json({
            message: 'Request accepted and queued.',
            task_id: taskId,
            organization_id: orgId,
            action: `${targetResource}:${targetAction}`,
            status: 'ACCEPTED'
        });
    } catch (err) {
        console.error(`Error in /api/${targetResource}:`, err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

/**
 * POST /api/chat
 */
app.post('/api/chat', async (req, res) => {
    return handleRequest(req, res, 'agents', 'run', req.body);
});

/**
 * REST Endpoint: POST /api/agents/start -- requires agents:create
 */
app.post('/api/agents/start', async (req, res) => {
    return handleRequest(req, res, 'agents', 'create', req.body);
});

/**
 * REST Endpoint: GET /api/agents/:taskId -- status polling
 */
app.get('/api/agents/:taskId', async (req, res) => {
    const decoded = getContext(req);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const task = await getTaskStatus(req.params.taskId, decoded.org_id);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        return res.status(200).json(task);
    } catch (err) {
        console.error('Error in GET /api/agents/:taskId:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * REST Endpoint: POST /api/users -- requires users:manage
 */
app.post('/api/users', async (req, res) => {
    return handleRequest(req, res, 'users', 'manage', req.body);
});

/**
 * REST Endpoint: PUT /api/orgs -- requires organizations:update
 */
app.put('/api/orgs', async (req, res) => {
    return handleRequest(req, res, 'organizations', 'update', req.body);
});

/**
 * RBAC Validation Endpoint: POST /api/permissions/validate
 * Expects { userId, orgId, resource, action }
 */
app.post('/api/permissions/validate', async (req, res) => {
    const { userId, orgId, resource, action } = req.body;

    if (!userId || !orgId || !resource || !action) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const hasPerm = await checkPermission(userId, orgId, resource, action);
        return res.status(200).json({
            authorized: hasPerm,
            userId,
            orgId,
            resource,
            action
        });
    } catch (err) {
        console.error('Error in /api/permissions/validate:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Auth Gateway listening on port ${PORT}`);
});
