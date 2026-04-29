/**
 * Default "/api" is same-origin. In `next dev`, `next.config` rewrites proxy
 * to the auth gateway on :3001. Set NEXT_PUBLIC_AUTH_API_URL in production.
 */
 
export const CONFIG = {
  // Auth & Org API — routed through the Auth Gateway
  AUTH_API_URL: process.env.NEXT_PUBLIC_AUTH_API_URL || "/api",
 
  // Chat API
  CHAT_API_URL: process.env.NEXT_PUBLIC_CHAT_API_URL || "/api",
 
  // WebSocket for real-time task status (derived from current page URL if not set)
  WS_URL: process.env.NEXT_PUBLIC_WS_URL || (typeof window !== 'undefined' ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}` : 'ws://localhost:3002'),
 
  // Client Origin
  CLIENT_URL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
};
 
export default CONFIG;
 