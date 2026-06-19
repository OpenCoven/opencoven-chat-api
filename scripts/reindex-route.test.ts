import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { isAuthorizedReindexRequest } from "../app/api/cron/reindex/route";

const originalReindexSecret = process.env.REINDEX_SECRET;
const originalCronSecret = process.env.CRON_SECRET;

function requestWith(headers: Record<string, string>): NextRequest {
  return new NextRequest(
    new Request("https://salem.opencoven.ai/api/cron/reindex", {
      method: "POST",
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
