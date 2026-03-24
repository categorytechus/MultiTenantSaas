const http = require('http');
const { URL } = require('url');
const express = require('express');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const amqp = require('amqplib');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const PORT = process.env.PORT || 3002;
const JWT_KEY = process.env.JWT_KEY || 'dev-secret-key';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@rabbitmq.data.svc.cluster.local:5672';

// session_id -> Set<WebSocket>
// Replaces the old task_id-based subscriptions map.
// The frontend subscribes once per chat session; task_id is still available inside each event payload.
const sessionSubscriptions = new Map();

// --------------- WebSocket Server ---------------

const wss = new WebSocketServer({ server, path: '/ws/task-status' });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
        ws.close(4401, 'Missing token');
        return;
    }

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_KEY);
    } catch {
        ws.close(4401, 'Invalid or expired token');
        return;
    }

    ws.userContext = {
        user_id: decoded.sub,
        org_id: decoded.org_id,
        email: decoded.email
    };

    console.log(`WS connected: user=${decoded.sub} org=${decoded.org_id}`);

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            ws.send(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
            return;
        }

        if (msg.action === 'subscribe_session' && msg.session_id) {
            // Subscribe to all events for this chat session
            if (!sessionSubscriptions.has(msg.session_id)) {
                sessionSubscriptions.set(msg.session_id, new Set());
            }
            sessionSubscriptions.get(msg.session_id).add(ws);
            ws.send(JSON.stringify({ status: 'ok', message: `subscribed to session ${msg.session_id}` }));
        } else if (msg.action === 'ping') {
            ws.send(JSON.stringify({ status: 'ok', message: 'pong' }));
        } else {
            ws.send(JSON.stringify({ status: 'error', message: 'unknown action. Use subscribe_session or ping.' }));
        }
    });

    ws.on('close', () => {
        // Clean up all session subscriptions for this socket
        for (const [sessionId, clients] of sessionSubscriptions) {
            clients.delete(ws);
            if (clients.size === 0) sessionSubscriptions.delete(sessionId);
        }
        console.log(`WS disconnected: user=${decoded.sub}`);
    });
});

// --------------- RabbitMQ Consumer ---------------

async function startEventsConsumer() {
    let connection;
    while (true) {
        try {
            console.log(`Connecting to RabbitMQ at ${RABBITMQ_URL}...`);
            connection = await amqp.connect(RABBITMQ_URL);
            break;
        } catch (err) {
            console.error(`RabbitMQ connection failed: ${err.message}. Retrying in 5s...`);
            await new Promise((r) => setTimeout(r, 5000));
        }
    }

    const channel = await connection.createChannel();

    // Use 'topic' exchange to match the rest of the system
    await channel.assertExchange('saas_exchange', 'topic', { durable: true });

    // Use an exclusive, non-durable queue for this specific instance (Broadcast pattern)
    // This allows multiple replicas to each receive all events.
    const q = await channel.assertQueue('', {
        exclusive: true,
        durable: false,
        autoDelete: true
    });

    const queueName = q.queue;

    // Bind to the events.# pattern to catch all org-specific status updates
    await channel.bindQueue(queueName, 'saas_exchange', 'events.#');

    console.log(`Consuming from exclusive queue ${queueName} bound to events.#...`);

    channel.consume(queueName, (msg) => {
        if (!msg) return;

        try {
            const payload = JSON.parse(msg.content.toString());
            const { task_id, session_id, org_id } = payload;

            console.log(`Event received: task_id=${task_id}, session_id=${session_id}, org_id=${org_id}, routing_key=${msg.fields.routingKey}`);

            if (session_id && sessionSubscriptions.has(session_id)) {
                const notification = JSON.stringify({
                    type: 'task-status',
                    task_id,       // still included so the frontend knows which specific task updated
                    session_id,
                    data: payload
                });

                for (const ws of sessionSubscriptions.get(session_id)) {
                    // Safety check: only send if the WebSocket belongs to the correct org
                    if (ws.readyState === ws.OPEN && ws.userContext.org_id === org_id) {
                        ws.send(notification);
                    }
                }
            }

            channel.ack(msg);
        } catch (err) {
            console.error('Failed to process event:', err);
            channel.ack(msg);
        }
    });

    connection.on('close', () => {
        console.error('RabbitMQ connection closed. Restarting consumer in 5s...');
        setTimeout(startEventsConsumer, 5000);
    });
}

// --------------- Express ---------------

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

// --------------- Start ---------------

server.listen(PORT, () => {
    console.log(`Task-status service listening on port ${PORT}`);
    startEventsConsumer().catch((err) => {
        console.error('Failed to start events consumer:', err);
    });
});
