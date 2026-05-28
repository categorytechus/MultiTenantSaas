import { NextRequest } from 'next/server';

// Force dynamic so Next.js standalone never statically caches this route.
export const dynamic = 'force-dynamic';

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
      {
        headers: {
          Accept: 'text/event-stream',
          // Prevent backend subdomain-tenant resolver from treating the
          // proxy hostname ("server") as a tenant slug.
          host: 'localhost',
        },
        cache: 'no-store',
      },
    );
  } catch {
    return new Response('upstream unreachable', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), { status: upstream.status });
  }

  // Use a TransformStream so each SSE chunk is forwarded to the browser
  // immediately. Returning upstream.body directly causes Next.js standalone
  // to buffer the response before flushing, breaking real-time streaming.
  const { readable, writable } = new TransformStream();
  void upstream.body.pipeTo(writable);

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    },
  });
}
