const amqp = require('amqplib');

let connection = null;
let channel = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@rabbitmq.data.svc.cluster.local:5672';

/**
 * Connects to RabbitMQ and returns the channel
 */
const connect = async () => {
    if (channel) return channel;

    try {
        console.log(`Connecting to RabbitMQ at ${RABBITMQ_URL}...`);
        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();

        console.log('RabbitMQ connected');

        // Handle connection close
        connection.on('close', () => {
            console.error('RabbitMQ connection closed');
            connection = null;
            channel = null;
        });

        connection.on('error', (err) => {
            console.error('RabbitMQ connection error', err);
            connection = null;
            channel = null;
        });

        return channel;
    } catch (error) {
        console.error('Failed to connect to RabbitMQ', error);
        throw error;
    }
};

/**
 * Sets up the base infrastructure (Exchanges, Shared Queues)
 */
const setupInfrastructure = async () => {
    const ch = await connect();

    // 1. Dead Letter Exchange (DLX)
    await ch.assertExchange('dlx', 'fanout', { durable: true });

    // 2. Dead Letter Queue (DLQ)
    await ch.assertQueue('dead_letter_queue', { durable: true });
    await ch.bindQueue('dead_letter_queue', 'dlx', '');

    // 3. Main SaaS Exchange (Direct)
    await ch.assertExchange('saas_exchange', 'direct', { durable: true });

    // 4. Shared Tasks Queue
    await ch.assertQueue('tasks', {
        durable: true,
        arguments: { 'x-dead-letter-exchange': 'dlx' }
    });
    // Route "cmd.task.create" -> tasks
    await ch.bindQueue('tasks', 'saas_exchange', 'cmd.task.create');

    // 5. Shared Events Queue
    await ch.assertQueue('events', {
        durable: true,
        arguments: { 'x-dead-letter-exchange': 'dlx' }
    });
    // Route "event.created" -> events
    await ch.bindQueue('events', 'saas_exchange', 'event.created');

    console.log('RabbitMQ Infrastructure (Shared Queues) setup complete');
};

/**
 * Publishes a message to the shared exchange
 */
const publishMessage = async (routingKey, message) => {
    const ch = await connect();

    // Ensure topology exists (Lazy init - capable of being moved to startup script)
    await setupInfrastructure();

    const sent = ch.publish(
        'saas_exchange',
        routingKey,
        Buffer.from(JSON.stringify(message)),
        { persistent: true }
    );

    console.log(`Published to ${routingKey}: ${sent}`);
    return sent;
};

module.exports = {
    connect,
    setupInfrastructure,
    publishMessage
};
