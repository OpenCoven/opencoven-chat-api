import { Redis } from "@upstash/redis";
import type { BriefKnowledge, KnowledgeFreshness } from "./brief-contract";

type StoredIndexState = {
  docsHash?: string;
  indexedAt?: string;
};

type StoredHeartbeat = {
  checkedAt?: string;
  docsHash?: string;
};

const INDEX_STATE_KEY = "salem:docs:index:last";
const INDEX_HEARTBEAT_KEY = "salem:docs:index:lastcheck";

function classifyFreshness(
  indexedAt: string,
  checkedAt: string,
  nowMs: number,
): KnowledgeFreshness {
  const lastHealthyMs = Math.max(Date.parse(indexedAt), Date.parse(checkedAt));
  if (!Number.isFinite(lastHealthyMs)) return "unknown";

  const ageHours = Math.max(0, nowMs - lastHealthyMs) / 3_600_000;
  const freshHours = Number(process.env.SALEM_BRIEF_FRESH_HOURS ?? 24);
  const staleHours = Number(process.env.SALEM_BRIEF_STALE_HOURS ?? 72);

  if (!Number.isFinite(freshHours) || !Number.isFinite(staleHours) || freshHours < 0 || staleHours < freshHours) {
    return "unknown";
  }
  if (ageHours <= freshHours) return "fresh";
  if (ageHours <= staleHours) return "aging";
  return "stale";
}

export async function readBriefKnowledge(nowMs = Date.now()): Promise<BriefKnowledge> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return {
      sourceRevision: null,
      sourceHash: null,
      indexedAt: null,
      checkedAt: null,
      freshness: "unknown",
    };
  }

  try {
    const redis = new Redis({ url, token });
    const [state, heartbeat] = await Promise.all([
      redis.get<StoredIndexState>(INDEX_STATE_KEY),
      redis.get<StoredHeartbeat>(INDEX_HEARTBEAT_KEY),
    ]);

    const sourceHash = state?.docsHash ?? null;
    const indexedAt = state?.indexedAt ?? null;
    const checkedAt = heartbeat?.checkedAt ?? null;

    if (!sourceHash || !indexedAt || !checkedAt || heartbeat?.docsHash !== sourceHash) {
      return {
        sourceRevision: null,
        sourceHash,
        indexedAt,
        checkedAt,
        freshness: "unknown",
      };
    }

    return {
      sourceRevision: null,
      sourceHash,
      indexedAt,
      checkedAt,
      freshness: classifyFreshness(indexedAt, checkedAt, nowMs),
    };
  } catch {
    return {
      sourceRevision: null,
      sourceHash: null,
      indexedAt: null,
      checkedAt: null,
      freshness: "unknown",
    };
  }
}
