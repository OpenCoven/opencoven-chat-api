import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BRIEF_SCHEMA_VERSION,
  CLAIM_STATUSES,
  SOURCE_AUTHORITIES,
  AUDIENCES,
  DEPTHS,
  BriefValidationError,
  briefRequestSchema,
  briefResponseSchema,
  type BriefRequest,
  type BriefResponse,
} from "../rag/brief-contract";

// Run from the repository root, like the existing scripts/*.test.ts suites.
const fixtures = JSON.parse(readFileSync("scripts/fixtures/salem-brief-v1.json", "utf8"));
let count = 0;
function test(name: string, run: () => void) {
  run();
  count += 1;
  console.log(`ok ${count} - ${name}`);
}
function response(): BriefResponse {
  return structuredClone(fixtures.specified) as BriefResponse;
}
function rejectResponse(value: unknown) {
  const result = briefResponseSchema.safeParse(value);
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.error instanceof BriefValidationError);
  assert.throws(() => briefResponseSchema.parse(value), BriefValidationError);
}

// Compile-time assertions are checked by tsc; this function is not executed.
function typeChecks(request: BriefRequest, brief: BriefResponse) {
  // @ts-expect-error Caller-provided scope is not part of the request contract.
  request.scope = "salem.admin";
  // @ts-expect-error Confidence is not a numeric probability.
  brief.classification.confidence = 0.99;
  // @ts-expect-error Shipped is not a claim status.
  brief.classification.claimStatus = "shipped";
}
void typeChecks;

test("valid request and response fixtures round-trip without coercion", () => {
  assert.equal(BRIEF_SCHEMA_VERSION, "opencoven.salem-brief/v1");
  assert.deepEqual(briefRequestSchema.parse(fixtures.request), fixtures.request);
  assert.deepEqual(briefResponseSchema.parse(fixtures.specified), fixtures.specified);
  assert.deepEqual(briefResponseSchema.parse(fixtures.unknown), fixtures.unknown);
});
for (const [index, fixture] of fixtures.invalidRequests.entries()) {
  test(`reject invalid request fixture ${index}`, () => {
    assert.equal(briefRequestSchema.safeParse(fixture).success, false);
    assert.throws(() => briefRequestSchema.parse(fixture), BriefValidationError);
  });
}
for (const fixture of fixtures.invalidResponses) {
  test(`reject ${fixture.name}`, () => {
    const value = response();
    let target: any = value;
    for (const key of fixture.path.slice(0, -1)) target = target[key];
    const key = fixture.path[fixture.path.length - 1];
    if (fixture.remove) delete target[key];
    else target[key] = fixture.value;
    rejectResponse(value);
  });
}
for (const audience of AUDIENCES) {
  for (const depth of DEPTHS) {
    test(`request supports ${audience}/${depth}`, () => {
      assert.deepEqual(briefRequestSchema.parse({ ...fixtures.request, audience, depth }), {
        ...fixtures.request, audience, depth,
      });
    });
  }
}
for (const status of CLAIM_STATUSES) {
  test(`represent ${status} without promoting it`, () => {
    const value = status === "unknown" ? structuredClone(fixtures.unknown) : response();
    value.classification.claimStatus = status;
    if (status === "verified") value.evidence[0].sourceAuthority = "verification_evidence";
    if (status === "implemented") value.evidence[0].sourceAuthority = "implementation";
    assert.equal(briefResponseSchema.parse(value).classification.claimStatus, status);
  });
}
for (const sourceAuthority of SOURCE_AUTHORITIES) {
  test(`source authority ${sourceAuthority} is metadata, not a status promotion`, () => {
    const value = response();
    value.evidence[0].sourceAuthority = sourceAuthority;
    assert.equal(briefResponseSchema.parse(value).classification.claimStatus, "specified");
  });
}
for (const freshness of ["fresh", "aging", "stale", "unknown"] as const) {
  test(`${freshness} preserves knowledge state independently of confidence`, () => {
    const value = response();
    value.knowledge.freshness = freshness;
    const parsed = briefResponseSchema.parse(value);
    assert.equal(parsed.knowledge.freshness, freshness);
    assert.equal(parsed.classification.confidence, "high");
  });
}

test("unknown is a valid successful refusal, even with relevant evidence", () => {
  const value = response();
  value.classification = { claimStatus: "unknown", confidence: "low", safeToGeneralize: false };
  assert.equal(briefResponseSchema.safeParse(value).success, true);
  value.classification.confidence = "high";
  rejectResponse(value);
});
test("unknown cannot claim safe generalization", () => {
  const value = structuredClone(fixtures.unknown);
  value.classification.safeToGeneralize = true;
  rejectResponse(value);
});
test("historical/unknown freshness cannot claim safe generalization", () => {
  const value = response();
  value.classification.safeToGeneralize = true;
  assert.equal(briefResponseSchema.safeParse(value).success, true);
  for (const freshness of ["aging", "stale", "unknown"] as const) {
    value.knowledge.freshness = freshness;
    rejectResponse(value);
  }
  value.knowledge.freshness = "fresh";
  for (const lifecycle of ["historical", "deprecated", "unknown"] as const) {
    value.evidence[0].lifecycle = lifecycle;
    rejectResponse(value);
  }
});
test("proposed, experimental and deprecated are not generally supported", () => {
  for (const claimStatus of ["proposed", "experimental", "deprecated"] as const) {
    const value = response();
    value.classification = { claimStatus, confidence: "high", safeToGeneralize: true };
    rejectResponse(value);
  }
});
test("verified requires pinned verification evidence; a status label is not proof", () => {
  const value = response();
  value.classification.claimStatus = "verified";
  value.evidence[0].sourceAuthority = "verification_evidence";
  value.evidence[0].revision = null;
  rejectResponse(value);
  value.evidence[0].sourceHash = "b".repeat(64);
  assert.equal(briefResponseSchema.safeParse(value).success, true);
});
test("known provenance may be absent without inventing a revision or freshness", () => {
  const value = response();
  value.evidence[0] = { ...value.evidence[0], url: null, repository: null, path: null, revision: null };
  value.knowledge = structuredClone(fixtures.unknown.knowledge);
  assert.equal(briefResponseSchema.safeParse(value).success, true);
});
test("duplicate evidence ids fail closed", () => {
  const value = response();
  value.evidence.push(structuredClone(value.evidence[0]));
  rejectResponse(value);
});
for (const key of Object.keys(fixtures.specified.evidence[0])) {
  test(`missing evidence.${key} fails closed`, () => {
    const value: any = response();
    delete value.evidence[0][key];
    rejectResponse(value);
  });
}
for (const url of ["javascript:alert(1)", "file:///etc/passwd", "private://research/secret", "http://example.com", "https://user:secret@example.com", "https://example.com/?token=secret", "not a url"]) {
  test(`unsafe source URL rejected: ${url.split(":")[0]}`, () => {
    const value = response();
    value.evidence[0].url = url;
    rejectResponse(value);
  });
}
for (const path of ["/absolute.md", "../outside.md", "docs/../outside.md", "docs\\file.md", "./docs/file.md"]) {
  test(`noncanonical repository path rejected: ${path}`, () => {
    const value = response();
    value.evidence[0].path = path;
    rejectResponse(value);
  });
}
test("repository path requires a repository identity", () => {
  const value = response();
  value.evidence[0].repository = null;
  rejectResponse(value);
});
test("calendar timestamps use canonical UTC with milliseconds", () => {
  const value = response();
  value.knowledge.indexedAt = "2024-02-29T12:00:00.000Z";
  assert.equal(briefResponseSchema.safeParse(value).success, true);
  for (const timestamp of ["2025-02-29T12:00:00.000Z", "2026-09-08", "2026-09-08T12:00:00Z", "2026-09-08T12:00:00.000+00:00"]) {
    value.knowledge.indexedAt = timestamp;
    rejectResponse(value);
  }
});
test("request and response size boundaries are enforced without truncation", () => {
  assert.equal(briefRequestSchema.safeParse({ ...fixtures.request, question: "q".repeat(2000) }).success, true);
  assert.equal(briefRequestSchema.safeParse({ ...fixtures.request, question: "q".repeat(2001) }).success, false);
  const value = response();
  value.answer.sayThis = "s".repeat(6001);
  rejectResponse(value);
  value.answer.sayThis = "valid";
  value.answer.caveats = Array(17).fill("caveat");
  rejectResponse(value);
  value.answer.caveats = [];
  value.evidence = Array.from({ length: 33 }, (_, i) => ({ ...value.evidence[0], id: `e-${i}` }));
  rejectResponse(value);
});
test("nested unknown fields, undefined and sparse arrays are rejected", () => {
  for (const key of ["answer", "classification", "knowledge"] as const) {
    const value: any = response();
    value[key].extra = "ignored?";
    rejectResponse(value);
  }
  const value = response();
  (value.answer as any).followUp = undefined;
  rejectResponse(value);
  value.answer.followUp = null;
  value.answer.caveats = new Array(1);
  rejectResponse(value);
});
test("inherited fields, accessors and symbol fields are not JSON records", () => {
  rejectResponse(Object.create(fixtures.specified));
  const value = response();
  let evaluated = false;
  Object.defineProperty(value, "classification", { get() { evaluated = true; throw new Error("must not evaluate"); } });
  rejectResponse(value);
  assert.equal(evaluated, false);
  const symbolic: any = response();
  symbolic[Symbol("hidden")] = true;
  rejectResponse(symbolic);
  rejectResponse(JSON.parse('{"__proto__":{},"schemaVersion":"opencoven.salem-brief/v1"}'));
});
test("parsed output does not alias mutable input or silently rewrite prose", () => {
  const value = response();
  value.answer.sayThis = "  Keep my exact words.  ";
  const parsed = briefResponseSchema.parse(value);
  value.answer.sayThis = "changed";
  value.evidence[0].title = "changed";
  assert.equal(parsed.answer.sayThis, "  Keep my exact words.  ");
  assert.notEqual(parsed.evidence[0].title, "changed");
});
test("diagnostics identify paths without copying supplied secret values", () => {
  const value = response();
  (value.classification as any).confidence = "secret-value";
  const parsed = briefResponseSchema.safeParse(value);
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.equal(parsed.error.path, "response.classification.confidence");
    assert.equal(parsed.error.message.includes("secret-value"), false);
  }
});
test("enum tables cannot be mutated at runtime", () => {
  assert.equal(Object.isFrozen(CLAIM_STATUSES), true);
  assert.throws(() => (CLAIM_STATUSES as unknown as string[]).push("shipped"), TypeError);
});
test("arrays reject extra fields, symbols and accessors", () => {
  const value: any = response();
  value.answer.caveats.extra = true;
  rejectResponse(value);
  value.answer.caveats = [];
  value.answer.caveats[Symbol("hidden")] = true;
  rejectResponse(value);
  let evaluated = false;
  value.answer.caveats = ["safe"];
  Object.defineProperty(value.answer.caveats, "0", { get() { evaluated = true; return "unsafe"; } });
  rejectResponse(value);
  assert.equal(evaluated, false);
});
for (const value of [null, undefined, true, 1, NaN, Infinity, "json?", [], () => ({}), new Date()]) {
  test(`reject non-object boundary input (${typeof value})`, () => {
    assert.equal(briefRequestSchema.safeParse(value).success, false);
    rejectResponse(value);
  });
}
console.log(`brief-contract: ${count} tests passed`);
