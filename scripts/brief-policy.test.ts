import assert from "node:assert/strict";
import {
  briefResponseSchema,
  type BriefEvidence,
  type BriefKnowledge,
} from "../rag/brief-contract";
import {
  classifyBriefQuestion,
  confidenceFromScore,
  hasUnsafeUnsupportedLanguage,
  maximumClaimStatus,
  unknownBriefResponse,
} from "../rag/brief-policy";

const knowledge: BriefKnowledge = {
  sourceRevision: null,
  sourceHash: null,
  indexedAt: null,
  checkedAt: null,
  freshness: "unknown",
};

const docsEvidence: BriefEvidence[] = [
  {
    id: "docs-1",
    title: "OpenCoven docs",
    url: "https://docs.opencoven.ai/",
    summary: "Canonical documentation evidence.",
    sourceAuthority: "canonical_docs",
    lifecycle: "current",
    repository: null,
    path: null,
    revision: null,
    sourceHash: null,
  },
];

const implementationEvidence: BriefEvidence[] = [
  {
    ...docsEvidence[0],
    id: "implementation-1",
    sourceAuthority: "implementation",
    repository: "OpenCoven/coven",
    path: "crates/example/src/lib.rs",
    revision: "a".repeat(40),
  },
];

const verificationEvidence: BriefEvidence[] = [
  {
    ...docsEvidence[0],
    id: "verification-1",
    sourceAuthority: "verification_evidence",
    sourceHash: "b".repeat(64),
  },
];

const goldenCases = [
  ["What is OpenCoven?", "general"],
  ["What is a familiar?", "general"],
  ["Is OpenCoven just memory?", "comparison"],
  ["Can a familiar change models?", "architecture"],
  ["Does OpenCoven support every model?", "release_sensitive"],
  ["Is OpenCoven fully local?", "general"],
  ["Is OpenCoven private?", "security_privacy"],
  ["Is a familiar a person?", "general"],
  ["What does SPAR do?", "architecture"],
  ["What does Threads do?", "architecture"],
  ["What does Psyche do?", "architecture"],
  ["What is Coven?", "architecture"],
  ["What is Cave?", "architecture"],
  ["Can OpenCoven act without permission?", "security_privacy"],
  ["Is OpenCoven production ready?", "release_sensitive"],
] as const;

for (const [question, expected] of goldenCases) {
  assert.equal(classifyBriefQuestion(question), expected, question);
}

assert.equal(maximumClaimStatus("general", docsEvidence), "specified");
assert.equal(maximumClaimStatus("release_sensitive", docsEvidence), "unknown");
assert.equal(maximumClaimStatus("release_sensitive", implementationEvidence), "implemented");
assert.equal(maximumClaimStatus("release_sensitive", verificationEvidence), "verified");
assert.equal(maximumClaimStatus("general", []), "unknown");

assert.equal(confidenceFromScore(0.9, false), "high");
assert.equal(confidenceFromScore(0.5, false), "medium");
assert.equal(confidenceFromScore(0.9, true), "low");

const unsafe = [
  "OpenCoven supports every LLM.",
  "It works with every model.",
  "OpenCoven guarantees privacy.",
  "It is definitely secure.",
  "The familiar is conscious.",
  "The familiar legally owns the data.",
];
for (const text of unsafe) {
  assert.equal(hasUnsafeUnsupportedLanguage(text), true, text);
}
assert.equal(
  hasUnsafeUnsupportedLanguage(
    "OpenCoven is designed for portability, but support must be verified per environment.",
  ),
  false,
);

const fallback = unknownBriefResponse({
  queryId: "brief-test-1",
  question: "Does OpenCoven support every model?",
  knowledge,
  caveat: "Current support needs implementation evidence.",
});
assert.equal(fallback.answer.sayThis, "I wouldn't claim that yet.");
assert.equal(fallback.classification.claimStatus, "unknown");
assert.equal(fallback.classification.confidence, "low");
assert.equal(fallback.classification.safeToGeneralize, false);
assert.deepEqual(fallback.evidence, []);
assert.equal(briefResponseSchema.safeParse(fallback).success, true);

console.log("brief-policy: ok");
