import amqp from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@rabbitmq.data.svc.cluster.local:5672';
const queue = 'demo.queue';

async function consume() {
    console.log(`Connecting to RabbitMQ at ${RABBITMQ_URL.replace(/:([^:@]+)@/, ':****@')}...`);

    let connection;
    try {
        connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();

        await channel.assertQueue(queue, { durable: true });
        console.log(`Waiting for message on "${queue}"...`);

        const messagePromise = new Promise((resolve) => {
            channel.consume(queue, (msg) => {
                if (msg !== null) {
                    const content = msg.content.toString();
                    console.log(`Received: ${content}`);
                    channel.ack(msg);
                    resolve(content);
                }
            }, { noAck: false });
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout: No message received in 10 seconds')), 10000);
        });

        await Promise.race([messagePromise, timeoutPromise]);

        await channel.close();
        await connection.close();
        process.exit(0);
    } catch (error) {
        console.error(error.message);
        if (connection) {
            try { await connection.close(); } catch (e) { }
        }
        process.exit(1);
    }
}

consume();
