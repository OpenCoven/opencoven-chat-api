import { Redis } from "@upstash/redis";
import {
  fetchIndexedSourceText,
  indexDocs as defaultIndexDocs,
  LLMS_FULL_URL,
  type IndexResult,
} from "./indexer";

const REINDEX_STATE_KEY = "salem:docs:index:last";
const REINDEX_HEARTBEAT_KEY = "salem:docs:index:lastcheck";

export type { IndexResult };

export interface ReindexState {
  docsHash: string;
  docsLength: number;
  docsUrl: string;
  indexedAt: string;
  trigger: string;
  result: Pick<IndexResult, "pagesProcessed" | "chunksCreated" | "uniqueTerms" | "duration">;
}

export interface ReindexStateStore {
  get(): Promise<ReindexState | null>;
  set(state: ReindexState): Promise<void>;
  // Optional: record a per-run heartbeat. Stores without it simply skip
  // heartbeat tracking (keeps existing/custom stores backward-compatible).
  recordCheck?(heartbeat: ReindexHeartbeat): Promise<void>;
}

export interface ReindexDecision {
  status: "indexed" | "skipped" | "error";
  reason: "first-index" | "changed" | "forced" | "unchanged" | "index-failed";
  docsHash: string;
  docsLength: number;
  previousHash: string | null;
  result: IndexResult | null;
  stateStorage: "redis" | "disabled" | "custom";
  errors: string[];
}

/**
 * Recorded on every reindex evaluation — including skipped/unchanged runs that
 * otherwise leave no trace — so scheduled (cron) runs are observable: read
 * `salem:docs:index:lastcheck` from Redis to see when the cron last fired.
 */
export interface ReindexHeartbeat {
  checkedAt: string;
  trigger: string;
  status: ReindexDecision["status"];
  reason: ReindexDecision["reason"];
  docsHash: string;
}

interface ReindexDocsOptions {
  trigger: string;
  force?: boolean;
  store?: ReindexStateStore | null;
  fetchDocsText?: () => Promise<string>;
  indexDocs?: () => Promise<IndexResult>;
}

class RedisReindexStateStore implements ReindexStateStore {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async get(): Promise<ReindexState | null> {
    return await this.redis.get<ReindexState>(REINDEX_STATE_KEY);
  }

  async set(state: ReindexState): Promise<void> {
    await this.redis.set(REINDEX_STATE_KEY, state);
  }

  async recordCheck(heartbeat: ReindexHeartbeat): Promise<void> {
    await this.redis.set(REINDEX_HEARTBEAT_KEY, heartbeat);
  }
}

export function createRedisReindexStateStore(): ReindexStateStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn("Reindex freshness guard disabled: Upstash Redis is not configured");
    return null;
  }

  return new RedisReindexStateStore(new Redis({ url, token }));
}

export async function fetchDocsText(): Promise<string> {
  return await fetchIndexedSourceText();
}

export async function hashDocsText(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(content));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function reindexDocsIfChanged({
  trigger,
  force = false,
  store = createRedisReindexStateStore(),
  fetchDocsText: fetchText = fetchDocsText,
  indexDocs = defaultIndexDocs,
}: ReindexDocsOptions): Promise<ReindexDecision> {
  const docsText = await fetchText();
  const docsHash = await hashDocsText(docsText);
  const previous = store ? await store.get() : null;
  const previousHash = previous?.docsHash ?? null;
  const stateStorage = store ? (store instanceof RedisReindexStateStore ? "redis" : "custom") : "disabled";

  let decision: ReindexDecision;

  if (!force && previousHash === docsHash) {
    decision = {
      status: "skipped",
      reason: "unchanged",
      docsHash,
      docsLength: docsText.length,
      previousHash,
      result: previous
        ? {
            success: true,
            pagesProcessed: previous.result.pagesProcessed,
            chunksCreated: previous.result.chunksCreated,
            uniqueTerms: previous.result.uniqueTerms,
            errors: [],
            duration: previous.result.duration,
          }
        : null,
      stateStorage,
      errors: [],
    };
  } else {
    const result = await indexDocs();
    const reason = force ? "forced" : previousHash ? "changed" : "first-index";

    if (!result.success) {
      decision = {
        status: "error",
        reason: "index-failed",
        docsHash,
        docsLength: docsText.length,
        previousHash,
        result,
        stateStorage,
        errors: result.errors,
      };
    } else {
      if (store) {
        await store.set({
          docsHash,
          docsLength: docsText.length,
          docsUrl: LLMS_FULL_URL,
          indexedAt: new Date().toISOString(),
          trigger,
          result: {
            pagesProcessed: result.pagesProcessed,
            chunksCreated: result.chunksCreated,
            uniqueTerms: result.uniqueTerms,
            duration: result.duration,
          },
        });
      }

      decision = {
        status: "indexed",
        reason,
        docsHash,
        docsLength: docsText.length,
        previousHash,
        result,
        stateStorage,
        errors: [],
      };
    }
  }

  // Heartbeat: record every evaluation (incl. skips) so scheduled runs are
  // observable. Best-effort — a heartbeat failure must not fail the reindex.
  if (store?.recordCheck) {
    try {
      await store.recordCheck({
        checkedAt: new Date().toISOString(),
        trigger,
        status: decision.status,
        reason: decision.reason,
        docsHash,
      });
    } catch (error) {
      console.warn("Reindex heartbeat write failed:", error);
    }
  }

  return decision;
}
