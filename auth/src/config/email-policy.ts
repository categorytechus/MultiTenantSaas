/**
 * Whether API responses may include debug email material (OTP, invite links, set-password links).
 * Staging/production never expose these, even if EMAIL_DEBUG_FALLBACK is mistakenly set.
 */
export function allowEmailDebugResponse(): boolean {
    const nodeEnv = process.env.NODE_ENV;
    const appEnv = process.env.APP_ENV;
    if (nodeEnv === "production" || appEnv === "staging") {
      return false;
    }
    return process.env.EMAIL_DEBUG_FALLBACK === "true";
  }