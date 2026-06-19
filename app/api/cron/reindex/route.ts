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

function getConfiguredSecret(): string | null {
  return process.env.REINDEX_SECRET || process.env.CRON_SECRET || null;
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
  const configured = getConfiguredSecret();
  const provided = getRequestSecret(request);
  return Boolean(configured && provided && constantTimeEqual(configured, provided));
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "scheduled docs reindex",
    configured: Boolean(getConfiguredSecret()),
  });
}

export async function POST(request: NextRequest) {
  if (!getConfiguredSecret()) {
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
