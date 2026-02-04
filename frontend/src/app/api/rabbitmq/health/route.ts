import { NextResponse } from 'next/server';
import amqp from 'amqplib';

export const dynamic = 'force-dynamic';

export async function GET() {
    const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://admin:admin@rabbitmq.data.svc.cluster.local:5672';

    let connection;
    try {
        // Attempt to connect
        connection = await amqp.connect(RABBITMQ_URL);

        // Attempt to create a channel
        const channel = await connection.createChannel();

        // Peacefully close channel and connection
        await channel.close();
        await connection.close();

        return NextResponse.json({ ok: true });
    } catch (error: any) {
        if (connection) {
            try {
                await connection.close();
            } catch (closeError) {
                // Ignore close errors if the connection was already broken
            }
        }

        return NextResponse.json(
            { ok: false, error: error.message || 'Failed to connect to RabbitMQ' },
            { status: 500 }
        );
    }
}
