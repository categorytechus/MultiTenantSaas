/**
 * Default "/api" keeps browser requests same-origin with Next.js.
 * In dev, next.config rewrites proxy to FastAPI on :8000.
 */

export const CONFIG = {
  // Auth & Org API via Next.js same-origin proxy
  AUTH_API_URL: process.env.NEXT_PUBLIC_AUTH_API_URL || "/api",

  // Chat API
  CHAT_API_URL: process.env.NEXT_PUBLIC_CHAT_API_URL || "/api",
  
  // WebSocket for real-time task status (derived from current page URL if not set)
  WS_URL: process.env.NEXT_PUBLIC_WS_URL || (typeof window !== 'undefined' ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}` : 'ws://localhost:3002'),
  
  // Client Origin
  CLIENT_URL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
};

export default CONFIG;
