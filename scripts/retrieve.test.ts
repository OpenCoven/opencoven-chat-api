import assert from "node:assert/strict";
import {
  buildRetrievalContext,
  computeRelevanceRank,
  filterPrivateRetrievalResults,
  USER_RETRIEVAL_STRATEGIES,
  type SalemRetrievalResult,
} from "../rag/retrieve";

const publicResult: SalemRetrievalResult = {
  id: "public",
  content: "A".repeat(1300),
  title: "Public docs",
  url: "https://docs.opencoven.ai/reference",
  score: 0.8,
};
const privateResult: SalemRetrievalResult = {
  id: "private",
  content: "private",
  title: "Private research",
  url: "private://opencoven/research/brief",
  score: 0.9,
};

assert.deepEqual(USER_RETRIEVAL_STRATEGIES, [
  "auto",
  "hybrid",
  "semantic",
  "keyword",
]);

assert.deepEqual(
  filterPrivateRetrievalResults([publicResult, privateResult], false),
  [publicResult],
);
assert.deepEqual(
  filterPrivateRetrievalResults([publicResult, privateResult], true),
  [publicResult, privateResult],
);

const context = buildRetrievalContext([publicResult]);
assert.ok(context.startsWith("[Public docs](https://docs.opencoven.ai/reference)\n"));
assert.equal(context.includes("A".repeat(1201)), false);
assert.equal(buildRetrievalContext([]), "");

assert.equal(computeRelevanceRank(0.8, 5, "lookup", false), 5);
assert.equal(computeRelevanceRank(0, 0, "comparison", true), 1);
assert.equal(computeRelevanceRank(0.3, 2, "conceptual", true), 2);
assert.equal(computeRelevanceRank(0.5, 2, "troubleshooting", false), 4);

console.log("retrieve: ok");
