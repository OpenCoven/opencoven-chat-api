import assert from "node:assert/strict";
import { fetchIndexedSourceText } from "../rag/indexer";

// The reindex freshness guard hashes fetchIndexedSourceText(). Any source that
// indexDocs() indexes but this omits can never invalidate the hash, so the guard
// reports "unchanged" forever and that content silently rots in the index.
// This test pins every source into the hashed text.

const originalFetch = globalThis.fetch;
const originalPrivate = process.env.SALEM_PRIVATE_RESEARCH_DOCS_BASE64;

const OPENCOVEN_BODY = "# OpenCoven Page\nSource: https://docs.opencoven.ai/familiars\n\nOpenCoven marker body.";
const TYPESAFE_BODY = "# TypeSafe Page\nSource: https://docs.typesafe.ai/jev\n\nTypeSafe marker body.";
const COVEN_CODE_BODY = "# Coven Code Agents\n\nCovenCodeMarker body long enough to survive the fifty character minimum filter.";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

try {
  process.env.SALEM_PRIVATE_RESEARCH_DOCS_BASE64 = Buffer.from(
    "# Private Paper\n\nPrivateResearchMarker body with enough detail to become an indexed research source.",
    "utf8",
  ).toString("base64");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.startsWith("https://docs.opencoven.ai/llms-full.txt")) {
      return new Response(OPENCOVEN_BODY, { status: 200 });
    }
    if (url.startsWith("https://docs.typesafe.ai/llms-full.txt")) {
      return new Response(TYPESAFE_BODY, { status: 200 });
    }
    if (url.startsWith("https://api.github.com/repos/OpenCoven/coven-code/git/trees/")) {
      return jsonResponse({ tree: [{ path: "docs/agents.md", type: "blob" }] });
    }
    if (url.startsWith("https://raw.githubusercontent.com/OpenCoven/coven-code/main/")) {
      return new Response(COVEN_CODE_BODY, { status: 200 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof globalThis.fetch;

  const text = await fetchIndexedSourceText();

  assert.ok(text.includes("OpenCoven marker body"), "OpenCoven llms-full.txt must be hashed");
  assert.ok(text.includes("TypeSafe marker body"), "TypeSafe llms-full.txt must be hashed");
  assert.ok(
    text.includes("CovenCodeMarker"),
    "Coven Code docs are indexed, so they must be hashed or they can never trigger a reindex",
  );
  assert.ok(
    text.includes("https://code.opencoven.ai/agents"),
    "Coven Code pages must be hashed under their published citation URL",
  );
  assert.ok(
    text.includes("PrivateResearchMarker"),
    "private research is indexed, so it must be hashed",
  );

  // ./docs/*.md are indexed by loadSupplementaryDocs(); an edit there must move the hash.
  assert.ok(
    text.includes("docs.opencoven.ai") && text.includes("Source:"),
    "supplementary local docs must contribute to the hashed text",
  );

  // A Coven Code outage must not silently produce the same hash as a healthy
  // run, which would let a real change be skipped.
  const healthy = text;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://docs.opencoven.ai/llms-full.txt")) {
      return new Response(OPENCOVEN_BODY, { status: 200 });
    }
    if (url.startsWith("https://docs.typesafe.ai/llms-full.txt")) {
      return new Response(TYPESAFE_BODY, { status: 200 });
    }
    if (url.startsWith("https://api.github.com/repos/OpenCoven/coven-code/git/trees/")) {
      return new Response("nope", { status: 500 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof globalThis.fetch;

  const degraded = await fetchIndexedSourceText();
  assert.notEqual(
    degraded,
    healthy,
    "a failed Coven Code fetch must change the hashed text so the run errs toward reindexing",
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalPrivate === undefined) {
    delete process.env.SALEM_PRIVATE_RESEARCH_DOCS_BASE64;
  } else {
    process.env.SALEM_PRIVATE_RESEARCH_DOCS_BASE64 = originalPrivate;
  }
}

console.log("indexed-source-text: ok");
