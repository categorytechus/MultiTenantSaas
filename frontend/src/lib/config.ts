/**
 * Centralized configuration for frontend services.
 * Uses environment variables with safe fallbacks for local development.
 */

export const CONFIG = {
  // Auth & Org API — routed through the Auth Gateway
  AUTH_API_URL: process.env.NEXT_PUBLIC_AUTH_API_URL || 'http://localhost:3001/api',
  
  // Chat API
  CHAT_API_URL: process.env.NEXT_PUBLIC_CHAT_API_URL || 'http://localhost:3001/api',
  
  // WebSocket for real-time task status
  WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3002',
  
  // Client Origin
  CLIENT_URL: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
};

export default CONFIG;
