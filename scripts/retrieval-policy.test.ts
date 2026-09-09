import assert from "node:assert/strict";
import {
  filterPrivateSourceResults,
  isPrivateSourceUrl,
} from "../rag/private-sources";
import {
  buildRetrievalContext,
  computeRelevanceRank,
} from "../rag/retrieval-policy";

assert.equal(isPrivateSourceUrl("private://opencoven/research/inline"), true);
assert.equal(isPrivateSourceUrl("https://docs.opencoven.ai/reference"), false);

const publicResult = {
  id: "public",
  title: "Public docs",
  url: "https://docs.opencoven.ai/reference",
  content: "Public evidence",
  score: 0.9,
};
const privateResult = {
  id: "private",
  title: "Private research",
  url: "private://opencoven/research/inline",
  content: "Private evidence",
  score: 0.95,
};

assert.deepEqual(
  filterPrivateSourceResults([publicResult, privateResult], false),
  [publicResult],
);
assert.deepEqual(
  filterPrivateSourceResults([publicResult, privateResult], true),
  [publicResult, privateResult],
);

assert.equal(computeRelevanceRank(0, 0, "conceptual", true), 1);
assert.equal(computeRelevanceRank(0.8, 5, "lookup", false), 5);
assert.equal(computeRelevanceRank(0.5, 2, "conceptual", false), 4);
assert.equal(computeRelevanceRank(0.2, 1, "comparison", true), 1);

assert.equal(buildRetrievalContext([]), "");
assert.equal(
  buildRetrievalContext([publicResult]),
  "[Public docs](https://docs.opencoven.ai/reference)\nPublic evidence",
);

const longContent = "x".repeat(1500);
const context = buildRetrievalContext([
  { ...publicResult, content: longContent },
  {
    ...publicResult,
    id: "second",
    title: "Second",
    url: "https://docs.opencoven.ai/second",
    content: "Second evidence",
  },
]);
assert.equal(context.includes("x".repeat(1201)), false);
assert.equal(context.includes("\n\n---\n\n[Second]"), true);

console.log("retrieval-policy: ok");
