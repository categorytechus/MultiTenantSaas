/**
 * Verification Script for WebSocket Org-Specific Routing
 * 
 * This script:
 * 1. Connects to the task-status-service via WebSocket.
 * 2. Authenticates with a JWT for a specific Org ID.
 * 3. Subscribes to a Task ID.
 * 4. Publishes a status update to RabbitMQ with the events.{org_id} routing key.
 * 5. Verifies the message is received by the client.
 */

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const amqp = require('amqplib');

// Config - Adjust these if running outside the cluster or with different ports
const WS_URL = process.env.WS_URL || 'ws://localhost:3002/ws/task-status';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const JWT_KEY = process.env.JWT_KEY || 'development-secret';

const ORG_ID = 'test-org-123';
const TASK_ID = 'test-task-456';
const USER_ID = 'test-user-789';

async function runTest() {
    console.log('--- Starting WebSocket Routing Test ---');

    // 1. Generate Token
    const token = jwt.sign({
        sub: USER_ID,
        org_id: ORG_ID,
        email: 'test@example.com'
    }, JWT_KEY);

    console.log(`[1] Generated token for Org: ${ORG_ID}`);

    // 2. Connect WebSocket
    const ws = new WebSocket(`${WS_URL}?token=${token}`);

    ws.on('open', () => {
        console.log('[2] WebSocket connected');

        // 3. Subscribe to Task
        ws.send(JSON.stringify({
            action: 'subscribe',
            task_id: TASK_ID
        }));
        console.log(`[3] Subscribed to Task: ${TASK_ID}`);
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        console.log('[5] Received message via WS:', msg);

        if (msg.type === 'task-status' && msg.task_id === TASK_ID && msg.data.status === 'in_progress') {
            console.log('\nSUCCESS: WebSocket received the org-routed event!');
            process.exit(0);
        }
    });

    ws.on('error', (err) => console.error('WS Error:', err));
    ws.on('close', (code, reason) => console.log('WS Closed:', code, reason));

    // 4. Publish to RabbitMQ after a short delay
    setTimeout(async () => {
        try {
            console.log('[4] Connecting to RabbitMQ to publish event...');
            const connection = await amqp.connect(RABBITMQ_URL);
            const channel = await connection.createChannel();
            const exchange = 'saas_exchange';
            const routingKey = `events.${ORG_ID}`;

            await channel.assertExchange(exchange, 'topic', { durable: true });

            const payload = {
                task_id: TASK_ID,
                org_id: ORG_ID,
                status: 'in_progress',
                data: { message: 'Agent is working...' }
            };

            channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(payload)));
            console.log(`[4] Published event to ${exchange} with key ${routingKey}`);

            await channel.close();
            await connection.close();
        } catch (err) {
            console.error('RabbitMQ Error:', err);
            process.exit(1);
        }
    }, 2000);

    // Timeout safety
    setTimeout(() => {
        console.error('\nFAILED: Timeout waiting for WS message');
        process.exit(1);
    }, 10000);
}

runTest().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
