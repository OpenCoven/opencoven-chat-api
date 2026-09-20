import assert from "node:assert/strict";
import { visibilityForUrl, PRIVATE_URL_PREFIX } from "../rag/store-upstash";
import { filterPrivateSourceResults, isPrivateSourceUrl } from "../app/api/chat/auth";

// Layer 1: visibility is derived from the URL at index time and stored on the
// vector, so the store can exclude private chunks via a metadata filter.
assert.equal(visibilityForUrl("https://docs.opencoven.ai/familiars"), "public");
assert.equal(visibilityForUrl("private://opencoven/research/inline"), "private");
assert.equal(
  visibilityForUrl(`${PRIVATE_URL_PREFIX}github/OpenCoven/coven-research/papers/brief.md`),
  "private",
);

// A public-looking URL must never be classified private by accident, and a
// private URL must not slip through because of case or whitespace assumptions.
assert.equal(visibilityForUrl("https://example.com/private/thing"), "public");
assert.equal(visibilityForUrl("private://x"), "private");

// Layer 2: the caller-side filter stays as an independent second barrier, so a
// regression in either layer alone cannot expose private research.
const results = [
  { url: "https://docs.opencoven.ai/a" },
  { url: "private://opencoven/research/inline" },
  { url: "https://code.opencoven.ai/b" },
];

assert.deepEqual(
  filterPrivateSourceResults(results, false).map((r) => r.url),
  ["https://docs.opencoven.ai/a", "https://code.opencoven.ai/b"],
  "unprivileged callers must not receive private sources",
);
assert.equal(
  filterPrivateSourceResults(results, true).length,
  3,
  "privileged callers keep private sources",
);

// The two layers must agree on what "private" means; if they ever diverge, the
// store filter and the post-filter would protect different sets of chunks.
for (const { url } of results) {
  assert.equal(
    isPrivateSourceUrl(url),
    visibilityForUrl(url) === "private",
    `visibility disagreement for ${url}`,
  );
}

console.log("chunk-visibility: ok");
