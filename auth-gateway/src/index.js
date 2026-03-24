const express = require('express');
const { verifyToken, createEnrichedToken } = require('./auth_util');
const { Pool } = require('pg');
const amqp = require('amqplib');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(cors());
const jsonParser = express.json();

const PORT = process.env.PORT || 3001;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:4000';

const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'multitenant_saas',
    port: parseInt(process.env.DB_PORT || '5432')
});

let channel;
async function initMQ() {
    try {
        const conn = await amqp.connect(RABBITMQ_URL);
        conn.on('error', (err) => console.error('RabbitMQ connection error', err.message));
        channel = await conn.createChannel();
        channel.on('error', (err) => console.error('RabbitMQ channel error', err.message));
        
        await channel.assertExchange('saas_exchange', 'topic', { durable: true });
        
        await channel.assertQueue('tasks', { durable: true, arguments: { 'x-dead-letter-exchange': 'dlx' } });
        await channel.bindQueue('tasks', 'saas_exchange', 'tasks.#');
        
        console.log('RabbitMQ connected and topology declared in Auth Gateway');
    } catch (e) {
        console.error('MQ Init failed', e);
    }
}
initMQ();

const getContext = (req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    return verifyToken(token);
};

/**
 * Simple proxy/forwarder for synchronous management routes
 */
const forwardToAuthService = (req, res) => {
    const targetUrl = new URL(req.originalUrl, AUTH_SERVICE_URL);
    
    const headers = { ...req.headers };
    headers.host = new URL(AUTH_SERVICE_URL).host;

    let bodyStr = null;
    if (req.body && Object.keys(req.body).length > 0) {
        bodyStr = JSON.stringify(req.body);
        headers['content-length'] = Buffer.byteLength(bodyStr);
        headers['content-type'] = 'application/json';
    }

    const options = {
        method: req.method,
        headers: headers
    };

    const proxyReq = http.request(targetUrl, options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
    });

    if (bodyStr) {
        proxyReq.write(bodyStr);
        proxyReq.end();
    } else {
        req.pipe(proxyReq, { end: true });
    }
    
    proxyReq.on('error', (err) => {
        console.error('Proxy error:', err);
        res.status(502).json({ error: 'Bad Gateway', message: 'Auth Service unavailable' });
    });
};

// --- Synchronous Management Path (Proxy to Auth Service) ---
app.use('/api/auth', forwardToAuthService);
app.use('/api/organizations', forwardToAuthService);
app.use('/api/orgs', (req, res) => {
    // Alias /api/orgs to /api/organizations
    req.url = req.url.replace('/api/orgs', '/api/organizations');
    forwardToAuthService(req, res);
});
app.use('/api/users', forwardToAuthService);
app.use('/api/documents', forwardToAuthService);
app.use('/api/web-urls', forwardToAuthService);
app.use('/api/knowledge-base', forwardToAuthService);

// --- Asynchronous Agentic Path (Task Submission) ---
async function submitTask(req, res, actionType, requiredPermission) {
    const decoded = getContext(req);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const perms = decoded.permissions || [];
    if (!perms.includes(requiredPermission)) {
        return res.status(403).json({ error: 'Forbidden', message: `Missing permission: ${requiredPermission}` });
    }

    const { sub: userId, org_id: orgId } = decoded;
    console.log(`Submitting task for user=${userId} org=${orgId}`);
    const { prompt, sessionId } = req.body;
    const taskId = require('crypto').randomUUID();

    try {
        const sId = sessionId || require('crypto').randomUUID();

        await pool.query(
            'INSERT INTO agent_tasks (id, organization_id, user_id, agent_type, status, input_data, session_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [taskId, orgId, userId, 'orchestrator', 'pending', JSON.stringify({ prompt }), sId]
        );

        const msg = JSON.stringify({
            taskId, userId, orgId, prompt, action: actionType, sessionId: sId
        });
        
        const routingKey = `tasks.${orgId}`;
        channel.publish('saas_exchange', routingKey, Buffer.from(msg), { persistent: true });

        return res.status(202).json({ task_id: taskId, session_id: sId, action: actionType, message: 'Task accepted' });
    } catch (e) {
        console.error('Submission failed', e);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

app.post('/api/chat', jsonParser, (req, res) => submitTask(req, res, '', 'agents:run'));
app.post('/api/agents/start', jsonParser, (req, res) => submitTask(req, res, 'agents:create', 'agents:create'));
app.post('/api/agents/:agentId/run', jsonParser, (req, res) => submitTask(req, res, `agents:${req.params.agentId}`, 'agents:run'));

// --- Task Status Polling ---
app.get('/api/agents/:taskId', async (req, res) => {
    const decoded = getContext(req);
    if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

    const { org_id: orgId } = decoded;
    try {
        const result = await pool.query(
            `SELECT t.id, t.status, t.created_at, t.completed_at, r.result_data
             FROM agent_tasks t
             LEFT JOIN agent_results r ON t.id = r.task_id
             WHERE t.id = $1 AND t.organization_id = $2`,
            [req.params.taskId, orgId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        return res.status(200).json(result.rows[0]);
    } catch (e) {
        console.error('Status poll failed', e);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/verify', (req, res) => {
    const decoded = getContext(req);
    if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });
    res.set({
        'X-User-Id': decoded.sub,
        'X-Org-Id': decoded.org_id,
        'X-Permissions': JSON.stringify(decoded.permissions),
        'X-Email': decoded.email
    });
    return res.status(200).json({ status: 'authenticated' });
});

app.post('/token', (req, res) => {
    const { user, org_id, permissions } = req.body;
    if (!user?.id || !user?.email || !org_id) return res.status(400).json({ error: 'Bad Request' });
    const token = createEnrichedToken(user, org_id, permissions || []);
    return res.status(200).json({ token });
});

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Auth Gateway listening on port ${PORT}`));
