import type { NextConfig } from "next";

const apiBackendOrigin =
  process.env.API_BACKEND_ORIGIN || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * Same-origin `/api`: browser calls Next.js; dev rewrites forward to FastAPI.
   */
  async rewrites() {
    /*if (process.env.NODE_ENV !== "development") {
      return [];
    } */
    return [
      {
        source: "/api/:path*",
        destination: `${apiBackendOrigin}/api/:path*`,
      },
    ];
  },
};
 
export default nextConfig;
 