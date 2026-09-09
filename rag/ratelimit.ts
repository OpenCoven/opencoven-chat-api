/**
 * Rate limiting using Upstash Redis.
 *
 * Environment variables:
 *   UPSTASH_REDIS_REST_URL - Upstash Redis endpoint
 *   UPSTASH_REDIS_REST_TOKEN - Upstash Redis auth token
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const CHAT_RATE_LIMIT_REQUESTS = 10;
const CHAT_RATE_LIMIT_WINDOW = "60 s";
const BRIEF_RATE_LIMIT_REQUESTS = 30;
const BRIEF_RATE_LIMIT_WINDOW = "60 s";

let chatRatelimit: Ratelimit | null = null;
let briefRatelimit: Ratelimit | null = null;

function createRatelimit({
  requests,
  window,
  prefix,
}: {
  requests: number;
  window: `${number} s`;
  prefix: string;
}): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn("Rate limiting disabled: UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set");
    return null;
  }

  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(requests, window),
    analytics: true,
    prefix,
  });
}

function getChatRatelimit(): Ratelimit | null {
  if (chatRatelimit) return chatRatelimit;
  chatRatelimit = createRatelimit({
    requests: CHAT_RATE_LIMIT_REQUESTS,
    window: CHAT_RATE_LIMIT_WINDOW,
    prefix: "opencoven-chat",
  });
  return chatRatelimit;
}

function getBriefRatelimit(): Ratelimit | null {
  if (briefRatelimit) return briefRatelimit;
  briefRatelimit = createRatelimit({
    requests: BRIEF_RATE_LIMIT_REQUESTS,
    window: BRIEF_RATE_LIMIT_WINDOW,
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

async function limitWith(
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

/** Existing public-chat limiter: 10 requests / minute / identifier. */
export async function checkRateLimit(identifier: string): Promise<RateLimitResult | null> {
  return await limitWith(getChatRatelimit(), identifier);
}

/**
 * Quick Answer limiter: separate namespace and a burst-friendly 30 requests /
 * minute. Callers should use a non-secret credential fingerprint plus client IP
 * so raw bearer material is never persisted as a Redis key.
 */
export async function checkBriefRateLimit(identifier: string): Promise<RateLimitResult | null> {
  return await limitWith(getBriefRatelimit(), identifier);
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
