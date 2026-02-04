import { NextResponse } from 'next/server';
import amqp from 'amqplib';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@rabbitmq.data.svc.cluster.local:5672';
    const queue = 'demo.queue';

    try {
        const body = await request.json().catch(() => ({}));
        const message = body.message || 'hello';

        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();

        await channel.assertQueue(queue, { durable: true });
        channel.sendToQueue(queue, Buffer.from(message), { persistent: true });

        // Wait a small amount of time for the write to drain before closing
        // For a demonstration/proof, this is sufficient. In production, consider a persistent channel.
        await new Promise(resolve => setTimeout(resolve, 100));

        await channel.close();
        await connection.close();

        return NextResponse.json({ ok: true, sent: message });
    } catch (error: any) {
        return NextResponse.json(
            { ok: false, error: error.message || 'Failed to publish to RabbitMQ' },
            { status: 500 }
        );
    }
}
