/**
 * GitHub Webhook Handler for docs updates.
 * Triggers re-indexing when the OpenCoven docs main branch is updated.
 * 
 * Setup:
 * 1. Add GITHUB_WEBHOOK_SECRET to environment variables
 * 2. Create a webhook in your docs repo pointing to /api/webhook
 * 3. Select "push" events and set content type to application/json
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyGitHubSignature, isMainBranchPush } from "@/rag/indexer";
import { reindexDocsIfChanged } from "@/rag/reindex-freshness";

export const runtime = "nodejs";
// A full rebuild measured ~44s on 2026-09-20; the 60s platform default leaves
// no headroom for a webhook-triggered run.
export const maxDuration = 300;

// GitHub push payloads are well under this. The cap applies before signature
// verification, which is the only work an unauthenticated caller can force here.
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

// Store indexing status (note: in edge runtime, this won't persist across invocations)
let indexingStatus = {
  isIndexing: false,
  lastIndexed: null as Date | null,
  lastResult: null as {
    success: boolean;
    pagesProcessed: number;
    chunksCreated: number;
    duration: number;
    errors: string[];
  } | null,
};

/**
 * GET /api/webhook - Status endpoint
 */
export async function GET() {
  // Liveness only. The previous response exposed indexing state, page and chunk
  // counts, and indexer error strings to any anonymous caller.
  return NextResponse.json({
    status: "ok",
    webhook: "GitHub docs update webhook",
  });
}

/**
 * POST /api/webhook - GitHub webhook handler
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  // Verify webhook secret is configured
  if (!webhookSecret) {
    console.error("GITHUB_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook not configured", status: 500 },
      { status: 500 }
    );
  }

  // Reject oversized payloads before reading or hashing them: verification
  // happens after this point, so everything above it is unauthenticated work.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large", status: 413 }, { status: 413 });
  }

  // Get raw body for signature verification
  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large", status: 413 }, { status: 413 });
  }
  const signature = request.headers.get("X-Hub-Signature-256");
  const event = request.headers.get("X-GitHub-Event");
  const deliveryId = request.headers.get("X-GitHub-Delivery");

  console.log(`Webhook received: event=${event}, delivery=${deliveryId}`);

  // Verify signature
  if (!await verifyGitHubSignature(rawBody, signature, webhookSecret)) {
    console.error("Invalid webhook signature");
    return NextResponse.json(
      { error: "Invalid signature", status: 401 },
      { status: 401 }
    );
  }

  // Parse payload
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload", status: 400 },
      { status: 400 }
    );
  }

  // Handle ping event (GitHub sends this when webhook is created)
  if (event === "ping") {
    console.log("Webhook ping received");
    return NextResponse.json({
      status: "ok",
      message: "Webhook configured successfully",
    });
  }

  // Check if this is a main branch push
  if (!isMainBranchPush(event, payload)) {
    console.log(`Ignoring event: ${event} (not a main branch push)`);
    return NextResponse.json({
      status: "ignored",
      message: "Not a main branch push event",
    });
  }

  // Prevent concurrent indexing
  if (indexingStatus.isIndexing) {
    console.log("Indexing already in progress, skipping");
    return NextResponse.json({
      status: "skipped",
      message: "Indexing already in progress",
    });
  }

  // Trigger indexing
  console.log("Starting documentation re-index...");
  indexingStatus.isIndexing = true;

  try {
    const reindex = await reindexDocsIfChanged({
      trigger: "github:webhook",
    });

    indexingStatus.lastIndexed = new Date();
    indexingStatus.lastResult = reindex.result;
    indexingStatus.isIndexing = false;

    if (reindex.status === "skipped") {
      console.log("Indexing skipped: docs hash unchanged");
      return NextResponse.json({
        status: "skipped",
        message: "Published documentation is unchanged",
        reason: reindex.reason,
        docsHash: reindex.docsHash,
        stateStorage: reindex.stateStorage,
      });
    }

    if (reindex.result?.success) {
      console.log(
        `Indexing complete: ${reindex.result.chunksCreated} chunks from ${reindex.result.pagesProcessed} pages`,
      );
      return NextResponse.json({
        status: "success",
        message: "Documentation re-indexed successfully",
        reason: reindex.reason,
        docsHash: reindex.docsHash,
        stateStorage: reindex.stateStorage,
        result: {
          pagesProcessed: reindex.result.pagesProcessed,
          chunksCreated: reindex.result.chunksCreated,
          duration: reindex.result.duration,
        },
      });
    } else {
      console.error("Indexing failed:", reindex.errors);
      return NextResponse.json(
        {
          status: "error",
          message: "Indexing failed",
          errors: reindex.errors,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    indexingStatus.isIndexing = false;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Indexing error:", error);
    return NextResponse.json(
      { error: `Indexing failed: ${errorMessage}`, status: 500 },
      { status: 500 }
    );
  }
}
