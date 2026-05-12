import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.API_BACKEND_ORIGIN || 'http://127.0.0.1:8000';

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const qs = request.nextUrl.search;
  const url = `${BACKEND}/api/${path.join('/')}${qs}`;

  const headers = new Headers(request.headers);
  // Prevent the backend's subdomain-tenant resolver from extracting a tenant slug
  // from the proxy hostname (e.g. host.docker.internal → "host" → 403 mismatch)
  headers.set('host', 'localhost');
  // Let fetch set content-length from the actual body to avoid length mismatches
  headers.delete('content-length');
  headers.delete('transfer-encoding');

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: 'no-store',
    });

    const resHeaders = new Headers(upstream.headers);
    // Body is already decompressed by Node fetch; remove the header so the browser
    // doesn't try to decompress it a second time
    resHeaders.delete('content-encoding');
    resHeaders.delete('content-length');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch (err) {
    console.error('[proxy] upstream unreachable', url, err);
    return new NextResponse(
      JSON.stringify({ detail: 'Backend unreachable' }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }
}

export const GET     = proxy;
export const POST    = proxy;
export const PUT     = proxy;
export const PATCH   = proxy;
export const DELETE  = proxy;
export const OPTIONS = proxy;
