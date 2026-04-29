const axios = require('axios');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const amqp = require('amqplib');

const AUTH_GATEWAY_URL = process.env.AUTH_GATEWAY_URL || 'http://localhost:3001';
const TASK_STATUS_URL = process.env.TASK_STATUS_URL || 'http://localhost:3002/health';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:4000/health';
const RAG_HEALTH_URL = process.env.RAG_HEALTH_URL || 'http://localhost:8003/health';
const CHAT_HEALTH_URL = process.env.CHAT_HEALTH_URL || 'http://localhost:8004/health';
const WS_URL = process.env.WS_URL || 'ws://localhost:3002/ws/task-status';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';
const JWT_KEY = process.env.JWT_KEY || 'dev-secret-key';

const TEST_ORG_ID = '11111111-1111-1111-1111-111111111111';
const TEST_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function log(step, message) {
  console.log(`[${step}] ${message}`);
}

function makeToken() {
  return jwt.sign(
    {
      sub: TEST_USER_ID,
      email: 'alice@acme.com',
      org_id: TEST_ORG_ID,
      permissions: ['agents:run', 'agents:create', 'users:manage'],
      iss: 'multi-tenant-saas',
    },
    JWT_KEY
  );
}

async function expectHealth(url, name) {
  const response = await axios.get(url, { timeout: 5000 });
  log('health', `${name} responded with ${response.status}`);
}

async function submitTask(token) {
  const response = await axios.post(
    `${AUTH_GATEWAY_URL}/api/chat`,
    { prompt: 'Local plumbing test request' },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    }
  );

  if (response.status !== 202 || !response.data.task_id || !response.data.session_id) {
    throw new Error(`Unexpected task submission response: ${JSON.stringify(response.data)}`);
  }

  log('gateway', `Task accepted with task_id=${response.data.task_id} session_id=${response.data.session_id}`);
  return response.data;
}

async function pollTask(token, taskId) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const response = await axios.get(`${AUTH_GATEWAY_URL}/api/agents/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });

    if (response.status === 200) {
      const status = response.data.status;
      log('poll', `Task ${taskId} status=${status}`);
      if (['pending', 'running', 'completed', 'failed'].includes(status)) {
        return response.data;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Task ${taskId} was not visible via status polling within timeout`);
}

async function verifyWebSocket(token, sessionId, taskId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let connection;
    let channel;
    let timeoutHandle;
    let ws;

    const finish = async (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);

      try {
        if (channel) await channel.close();
      } catch (_) {}

      try {
        if (connection) await connection.close();
      } catch (_) {}

      try {
        if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      } catch (_) {}

      if (err) reject(err);
      else resolve();
    };

    timeoutHandle = setTimeout(() => {
      finish(new Error('Timed out waiting for WebSocket plumbing event'));
    }, 12000);

    ws = new WebSocket(`${WS_URL}?token=${token}`);

    ws.on('open', async () => {
      log('ws', 'WebSocket connected');
      ws.send(JSON.stringify({ action: 'subscribe_session', session_id: sessionId }));
      log('ws', `Subscribed to session ${sessionId}`);

      try {
        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertExchange('saas_exchange', 'topic', { durable: true });

        const payload = {
          task_id: taskId,
          session_id: sessionId,
          org_id: TEST_ORG_ID,
          status: 'plumbing_test',
          data: { message: 'Synthetic plumbing event' },
        };

        channel.publish(
          'saas_exchange',
          `events.${TEST_ORG_ID}`,
          Buffer.from(JSON.stringify(payload))
        );

        log('rabbitmq', `Published synthetic event for session ${sessionId}`);
      } catch (err) {
        finish(err);
      }
    });

    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());

        if (message.status === 'ok') {
          log('ws', `Subscription ack received: ${message.message}`);
          return;
        }

        if (
          message.type === 'task-status' &&
          message.session_id === sessionId &&
          message.task_id === taskId &&
          message.data &&
          message.data.status === 'plumbing_test'
        ) {
          log('ws', 'Received synthetic task-status event');
          finish();
        }
      } catch (err) {
        finish(err);
      }
    });

    ws.on('error', (err) => finish(err));
    ws.on('close', (code, reason) => {
      if (!settled && code !== 1000) {
        finish(new Error(`WebSocket closed unexpectedly: ${code} ${reason}`));
      }
    });
  });
}

async function main() {
  console.log('========================================');
  console.log(' Local Plumbing Test');
  console.log('========================================');

  const token = makeToken();

  await expectHealth(`${AUTH_GATEWAY_URL}/health`, 'auth-gateway');
  await expectHealth(TASK_STATUS_URL, 'task-status');
  await expectHealth(AUTH_SERVICE_URL, 'auth-service');

  try {
    await expectHealth(RAG_HEALTH_URL, 'rag-service');
  } catch (err) {
    log('warn', `RAG health check failed: ${err.message}`);
  }

  try {
    await expectHealth(CHAT_HEALTH_URL, 'chat-service');
  } catch (err) {
    log('warn', `Chat health check failed: ${err.message}`);
  }

  const task = await submitTask(token);
  await pollTask(token, task.task_id);
  await verifyWebSocket(token, task.session_id, task.task_id);

  console.log('');
  console.log('SUCCESS: local plumbing is working.');
  console.log('Verified gateway -> DB task creation/polling -> RabbitMQ -> WebSocket routing.');
}

main().catch((err) => {
  console.error('');
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
