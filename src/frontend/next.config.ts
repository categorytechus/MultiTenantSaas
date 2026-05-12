import type { NextConfig } from "next";

const apiBackendOrigin =
  process.env.API_BACKEND_ORIGIN || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * Same-origin `/api`: browser calls Next.js; dev rewrites forward to FastAPI.
   */
  // API proxying is handled by app/api/[...path]/route.ts at request time,
  // which reads API_BACKEND_ORIGIN as a runtime env var.
  async rewrites() {
    return [];
  },
};
 
export default nextConfig;
 