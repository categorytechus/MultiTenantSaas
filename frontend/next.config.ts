import type { NextConfig } from "next";
 
const authGatewayOrigin =
  process.env.AUTH_GATEWAY_PROXY_ORIGIN || "http://127.0.0.1:3001";
 
const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * Dev: same-origin /api so the browser only talks to Next; proxy to the gateway.
   * Production Docker sets NEXT_PUBLIC_* to full URLs; rewrites are skipped (NODE_ENV=production).
   */
  async rewrites() {
    if (process.env.NODE_ENV !== "development") {
      return [];
    }
    return [
      {
        source: "/api/:path*",
        destination: `${authGatewayOrigin}/api/:path*`,
      },
    ];
  },
};
 
export default nextConfig;
 