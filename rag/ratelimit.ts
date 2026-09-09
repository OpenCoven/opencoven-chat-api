/**
 * Rate limiting using Upstash Redis.
 *
 * Environment variables:
 *   UPSTASH_REDIS_REST_URL - Upstash Redis endpoint
 *   UPSTASH_REDIS_REST_TOKEN - Upstash Redis auth token
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW = "60 s";
const BRIEF_RATE_LIMIT_REQUESTS = 30;
const BRIEF_RATE_LIMIT_WINDOW = "60 s";

let ratelimit: Ratelimit | null = null;
let briefRatelimit: Ratelimit | null = null;

function redisFromEnv(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn("Rate limiting disabled: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set");
    return null;
  }

  return new Redis({ url, token });
}

function getRatelimit(): Ratelimit | null {
  if (ratelimit) return ratelimit;
  const redis = redisFromEnv();
  if (!redis) return null;

  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW),
    analytics: true,
    prefix: "opencoven-chat",
  });

  return ratelimit;
}

function getBriefRatelimit(): Ratelimit | null {
  if (briefRatelimit) return briefRatelimit;
  const redis = redisFromEnv();
  if (!redis) return null;

  briefRatelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(BRIEF_RATE_LIMIT_REQUESTS, BRIEF_RATE_LIMIT_WINDOW),
    analytics: true,
    prefix: "opencoven-brief",
  });

  return briefRatelimit;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

async function runLimit(
  limiter: Ratelimit | null,
  identifier: string,
): Promise<RateLimitResult | null> {
  if (!limiter) return null;
  const result = await limiter.limit(identifier);
  return {
    success: result.success,
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
  };
}

/** Existing chat limit: 10 requests / 60 seconds / IP. */
export async function checkRateLimit(identifier: string): Promise<RateLimitResult | null> {
  return runLimit(getRatelimit(), identifier);
}

/** Quick Answer limit: separate 30 requests / 60 seconds / credential+IP identifier. */
export async function checkBriefRateLimit(identifier: string): Promise<RateLimitResult | null> {
  return runLimit(getBriefRatelimit(), identifier);
}

/**
 * Extract client IP from Vercel request headers.
 */
export function getClientIp(headers: Record<string, string | string[] | undefined>): string {
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return ip.trim();
  }

  const realIp = headers["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return "unknown";
}
