import { NextRequest } from 'next/server';

const BACKEND = process.env.API_BACKEND_ORIGIN ?? 'http://127.0.0.1:8000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chat_id: string }> },
) {
  const { chat_id } = await params;
  const qs = request.nextUrl.searchParams.toString();

  let upstream: Response;
  try {
    upstream = await fetch(
      `${BACKEND}/api/chat/sessions/${chat_id}/stream?${qs}`,
      { headers: { Accept: 'text/event-stream' }, cache: 'no-store' },
    );
  } catch {
    return new Response('upstream unreachable', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
