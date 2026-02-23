const http = require('http');
const { URL } = require('url');
const express = require('express');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const amqp = require('amqplib');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3002;
const JWT_KEY = process.env.JWT_KEY || 'development-secret';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@rabbitmq.data.svc.cluster.local:5672';

// task_id -> Set<WebSocket>
const subscriptions = new Map();

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

        if (msg.action === 'subscribe' && msg.task_id) {
            if (!subscriptions.has(msg.task_id)) {
                subscriptions.set(msg.task_id, new Set());
            }
            subscriptions.get(msg.task_id).add(ws);
            ws.send(JSON.stringify({ status: 'ok', message: `subscribed to ${msg.task_id}` }));
        } else if (msg.action === 'ping') {
            ws.send(JSON.stringify({ status: 'ok', message: 'pong' }));
        } else {
            ws.send(JSON.stringify({ status: 'ok', message: 'unknown action' }));
        }
    });

    ws.on('close', () => {
        for (const [taskId, clients] of subscriptions) {
            clients.delete(ws);
            if (clients.size === 0) subscriptions.delete(taskId);
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

    await channel.assertExchange('saas_exchange', 'direct', { durable: true });
    await channel.assertQueue('events', {
        durable: true,
        arguments: { 'x-dead-letter-exchange': 'dlx' }
    });
    await channel.bindQueue('events', 'saas_exchange', 'event.created');

    console.log('Consuming from events queue...');

    channel.consume('events', (msg) => {
        if (!msg) return;

        try {
            const payload = JSON.parse(msg.content.toString());
            const taskId = payload.task_id;

            console.log(`Event received: task_id=${taskId}`);

            if (taskId && subscriptions.has(taskId)) {
                const notification = JSON.stringify({
                    type: 'task-status',
                    task_id: taskId,
                    data: payload
                });

                for (const ws of subscriptions.get(taskId)) {
                    if (ws.readyState === ws.OPEN) {
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
