import assert from "node:assert/strict";
import { fetchIndexedSourceText, fetchTypeSafeDocs, TYPESAFE_LLMS_FULL_URL } from "../rag/indexer";

const originalFetch = globalThis.fetch;
try {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    return new Response(url === TYPESAFE_LLMS_FULL_URL
      ? "# TypeSafe API\nSource: https://docs.typesafe.ai/api\n\nTypeSafe API reference with enough text to index and retrieve."
      : "# OpenCoven\nSource: https://docs.opencoven.ai/\n\nOpenCoven documentation with enough text to index and retrieve.");
  }) as typeof fetch;

  const pages = await fetchTypeSafeDocs();
  assert.equal(pages.length, 1);
  assert.equal(pages[0].url, "https://docs.typesafe.ai/api");
  assert.equal(pages[0].path, "/api");

  const sourceText = await fetchIndexedSourceText();
  assert.match(sourceText, /TypeSafe API reference/);
  assert.match(sourceText, /OpenCoven documentation/);
  assert.ok(calls.includes(TYPESAFE_LLMS_FULL_URL));
} finally {
  globalThis.fetch = originalFetch;
}

console.log("typesafe-source: ok");
