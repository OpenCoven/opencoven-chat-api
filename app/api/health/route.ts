/**
 * Health Check Endpoint
 *
 * Public callers get liveness only. The chunk count is a paid Upstash Vector
 * call and a usable oracle -- it moves when private research is added to or
 * removed from the index -- so it is reserved for signed-in callers. The
 * homepage reads the same figure directly via DocsStore (app/page.tsx), so the
 * UI is unaffected.
 */
import { NextRequest, NextResponse } from "next/server";
import { DocsStore } from "@/rag/store-upstash";
import { requestUser } from "@/lib/session-http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await requestUser(request).catch(() => null);

  if (!user) {
    return NextResponse.json(
      { ok: true, mode: "upstash-vector" },
      { headers: { "Cache-Control": "public, max-age=30" } },
    );
  }

  try {
    const chunks = await new DocsStore().count();
    return NextResponse.json(
      { ok: true, chunks, mode: "upstash-vector" },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
    );
  } catch (err) {
    console.error("Health check error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to connect to vector store" },
      { status: 500, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
    );
  }
}
