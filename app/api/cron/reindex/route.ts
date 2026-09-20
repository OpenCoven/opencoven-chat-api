/**
 * Protected scheduled re-index endpoint.
 *
 * Intended for QStash or another scheduler as a safety net for missed GitHub
 * webhooks and docs deploy timing races.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { reindexDocsIfChanged } from "@/rag/reindex-freshness";

export const runtime = "nodejs";
// A full rebuild measured ~44s on 2026-09-20; the platform default of 60s
// leaves almost no headroom as the corpus grows.
export const maxDuration = 300;

/**
 * Accepts either secret name. Vercel Cron only ever sends CRON_SECRET, while the
 * README and .env.example document REINDEX_SECRET; preferring one over the other
 * meant a deployment that set both to different values would fail authorization
 * on the scheduled run and, before this change, report success anyway.
 */
function getConfiguredSecrets(): string[] {
  return [process.env.REINDEX_SECRET, process.env.CRON_SECRET]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));
}

function isReindexConfigured(): boolean {
  return getConfiguredSecrets().length > 0;
}

function getRequestSecret(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-reindex-secret") || request.headers.get("x-cron-secret");
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

export function isAuthorizedReindexRequest(request: NextRequest): boolean {
  const provided = getRequestSecret(request);
  if (!provided) return false;
  // Compare against every configured secret so neither name is second-class.
  return getConfiguredSecrets().some((configured) => constantTimeEqual(configured, provided));
}

/**
 * Runs the freshness-guarded reindex and builds the JSON response.
 * Callers must verify authorization before invoking this.
 */
async function runReindex(request: NextRequest): Promise<NextResponse> {
  const force = request.nextUrl.searchParams.get("force") === "1";
  const result = await reindexDocsIfChanged({
    trigger: force ? "cron:force" : "cron",
    force,
  });

  if (result.status === "error") {
    return NextResponse.json(
      {
        status: "error",
        reason: result.reason,
        docsHash: result.docsHash,
        errors: result.errors,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: result.status,
    reason: result.reason,
    docsHash: result.docsHash,
    docsLength: result.docsLength,
    previousHash: result.previousHash,
    stateStorage: result.stateStorage,
    result: result.result
      ? {
          pagesProcessed: result.result.pagesProcessed,
          chunksCreated: result.result.chunksCreated,
          uniqueTerms: result.result.uniqueTerms,
          duration: result.result.duration,
        }
      : null,
  });
}

/**
 * Vercel Cron triggers this endpoint with a GET carrying
 * `Authorization: Bearer ${CRON_SECRET}`. Authorized requests run the reindex;
 * everything else is rejected. There is no anonymous status view.
 */
export async function GET(request: NextRequest) {
  if (!isReindexConfigured()) {
    return NextResponse.json(
      { status: "error", error: "REINDEX_SECRET or CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (!isAuthorizedReindexRequest(request)) {
    // Previously returned 200 with `configured`, which told any anonymous caller
    // whether a reindex secret was set. Nothing about this endpoint is public.
    return NextResponse.json({ status: "error", error: "Unauthorized" }, { status: 401 });
  }

  return runReindex(request);
}

export async function POST(request: NextRequest) {
  if (!isReindexConfigured()) {
    return NextResponse.json(
      { status: "error", error: "REINDEX_SECRET or CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (!isAuthorizedReindexRequest(request)) {
    return NextResponse.json(
      { status: "error", error: "Unauthorized" },
      { status: 401 },
    );
  }

  return runReindex(request);
}
