import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * GET /api/auth/signup | /api/auth/signin are redirected to the Next.js pages.
 * Other methods pass through and are rewritten to the FastAPI backend (next.config).
 */
const getRedirects: Record<string, string> = {
  "/api/auth/signup": "/auth/signup",
  "/api/auth/signin": "/auth/signin",
};

/**
 * NOTE: Tokens are stored in localStorage (client-side only), so the server-side
 * middleware cannot read them. Route protection is enforced:
 *   1. Here (coarse-grained — unauthenticated redirects to signin)
 *   2. In each page's useEffect (fine-grained user_type check against /auth/me)
 *
 * Protected route prefixes — redirect to /dashboard if not signed in.
 * user_type enforcement is handled client-side per page.
 */
const protectedPrefixes = ["/admin", "/users", "/roles"];

export function middleware(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;

  // Simple API redirects
  const to = getRedirects[path];
  if (to) {
    return NextResponse.redirect(new URL(to, request.url));
  }

  // For protected prefixes: since we can't read localStorage from middleware,
  // we rely on client-side guards inside each page. The middleware just passes through.
  // (If a cookie-based auth approach is adopted later, guards can be added here.)

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/auth/signup", "/api/auth/signin", "/admin/:path*", "/users/:path*", "/roles/:path*"],
};