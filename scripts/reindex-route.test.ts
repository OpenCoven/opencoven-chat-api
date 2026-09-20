import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, isAuthorizedReindexRequest } from "../app/api/cron/reindex/route";

const originalReindexSecret = process.env.REINDEX_SECRET;
const originalCronSecret = process.env.CRON_SECRET;

function requestWith(headers: Record<string, string>, method = "POST"): NextRequest {
  return new NextRequest(
    new Request("https://salem.opencoven.ai/api/cron/reindex", {
      method,
      headers,
    }),
  );
}

try {
  process.env.REINDEX_SECRET = "test-secret";
  delete process.env.CRON_SECRET;

  assert.equal(
    isAuthorizedReindexRequest(requestWith({ authorization: "Bearer test-secret" })),
    true,
  );
  assert.equal(
    isAuthorizedReindexRequest(requestWith({ "x-reindex-secret": "test-secret" })),
    true,
  );
  assert.equal(
    isAuthorizedReindexRequest(requestWith({ authorization: "Bearer wrong-secret" })),
    false,
  );
  assert.equal(isAuthorizedReindexRequest(requestWith({})), false);

  delete process.env.REINDEX_SECRET;
  process.env.CRON_SECRET = "fallback-secret";

  assert.equal(
    isAuthorizedReindexRequest(requestWith({ "x-cron-secret": "fallback-secret" })),
    true,
  );

  // Both names configured to different values: Vercel Cron sends CRON_SECRET,
  // so preferring REINDEX_SECRET alone used to fail the scheduled run silently.
  process.env.REINDEX_SECRET = "manual-secret";
  process.env.CRON_SECRET = "vercel-secret";
  assert.equal(
    isAuthorizedReindexRequest(requestWith({ authorization: "Bearer vercel-secret" })),
    true,
    "Vercel Cron's CRON_SECRET must authorize even when REINDEX_SECRET is also set",
  );
  assert.equal(
    isAuthorizedReindexRequest(requestWith({ authorization: "Bearer manual-secret" })),
    true,
    "REINDEX_SECRET must still authorize manual runs",
  );
  assert.equal(
    isAuthorizedReindexRequest(requestWith({ authorization: "Bearer neither" })),
    false,
  );

  // An unauthenticated GET must not reveal whether a reindex secret is configured.
  const anonymous = await GET(requestWith({}, "GET"));
  assert.equal(anonymous.status, 401, "anonymous GET must be rejected, not answered");
  const body = await anonymous.json();
  assert.equal(body.status, "error");
  assert.ok(!("configured" in body), "response must not disclose configuration state");
} finally {
  if (originalReindexSecret === undefined) {
    delete process.env.REINDEX_SECRET;
  } else {
    process.env.REINDEX_SECRET = originalReindexSecret;
  }

  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
}

console.log("reindex-route: ok");
