const amqp = require('amqplib');

let connection = null;
let channel = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@localhost:5672';

/**
 * Connects to RabbitMQ
 */
const connect = async () => {
    if (channel) return channel;
    try {
        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        console.log('RabbitMQ connected');
        return channel;
    } catch (error) {
        console.error('Failed to connect to RabbitMQ', error);
        throw error;
    }
};

/**
 * Publishes a task to the agent orchestrator with org-specific routing
 */
const publishTask = async (task) => {
    const ch = await connect();
    const exchange = 'saas_exchange';
    const routingKey = `tasks.${task.orgId}`;

    // Ensure exchange exists
    await ch.assertExchange(exchange, 'topic', { durable: true });

    ch.publish(exchange, routingKey, Buffer.from(JSON.stringify(task)), {
        persistent: true
    });
    console.log(`Task published to ${exchange} with routing key ${routingKey} (session: ${task.sessionId})`);
};

module.exports = {
    publishTask
};
