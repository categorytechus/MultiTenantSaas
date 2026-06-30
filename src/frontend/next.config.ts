import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

// Attempt to read CLIENT_JWT_LICENSE_TOKEN from root .env if not injected by docker
let clientJwtLicenseToken = process.env.CLIENT_JWT_LICENSE_TOKEN;
try {
  if (clientJwtLicenseToken === undefined) {
    const rootEnvPath = path.resolve(process.cwd(), "../../.env");
    if (fs.existsSync(rootEnvPath)) {
      const envContent = fs.readFileSync(rootEnvPath, "utf8");
      const match = envContent.match(/^CLIENT_JWT_LICENSE_TOKEN=(.*)$/m);
      if (match) {
        clientJwtLicenseToken = match[1].trim();
      }
    }
  }
} catch (e) {}

const apiBackendOrigin =
  process.env.API_BACKEND_ORIGIN || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_IS_PRIVATE_DEPLOYMENT: clientJwtLicenseToken ? "true" : "",
  },
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
 