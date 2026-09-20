/**
 * Rate limiting using Upstash Redis.
 *
 * Environment variables:
 *   UPSTASH_REDIS_REST_URL - Upstash Redis endpoint
 *   UPSTASH_REDIS_REST_TOKEN - Upstash Redis auth token
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Sliding window: 10 requests per 60 seconds per IP
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW = "60 s";

let ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (ratelimit) return ratelimit;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn("Rate limiting disabled: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set");
    return null;
  }

  const redis = new Redis({ url, token });

  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW),
    analytics: true,
    prefix: "opencoven-chat",
  });

  return ratelimit;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * Check rate limit for a given identifier.
 *
 * Prefer a stable, server-derived identifier such as a session user ID. IP
 * addresses come from client-supplied forwarding headers and are neither
 * unique per caller nor reliably attacker-controlled.
 *
 * Returns null only when rate limiting is legitimately disabled, which is
 * permitted in development but never in production: a misconfigured or
 * unreachable limiter must not silently remove the only spend control in
 * front of a paid model API.
 */
export async function checkRateLimit(identifier: string): Promise<RateLimitResult | null> {
  const limiter = getRatelimit();
  if (!limiter) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Rate limiting is unavailable: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in production",
      );
    }
    return null;
  }

  const result = await limiter.limit(identifier);

  return {
    success: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
  };
}

/**
 * Extract client IP from Vercel request headers.
 *
 * Only meaningful behind a proxy that overwrites these headers. Treat the
 * result as a coarse grouping hint, not an identity: callers arriving without
 * either header all share the "unknown" bucket.
 */
export function getClientIp(headers: Record<string, string | string[] | undefined>): string {
  // Vercel provides the real client IP in x-forwarded-for
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return ip.trim();
  }

  // Fallback to x-real-ip
  const realIp = headers["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return "unknown";
}
