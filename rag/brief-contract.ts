/**
 * opencoven.salem-brief/v1: inert wire contract, not an answering or auth policy.
 * Parsers accept unknown JSON-shaped values, reject rather than coerce, and copy
 * validated fields. Successful parsing does NOT establish truth or authority.
 */
export const BRIEF_SCHEMA_VERSION = "opencoven.salem-brief/v1" as const;
export const AUDIENCES = Object.freeze(["anyone", "ai_user", "creator", "developer", "security", "partner"] as const);
export const DEPTHS = Object.freeze(["quick", "conversation", "deep", "technical"] as const);
export const CLAIM_STATUSES = Object.freeze([
  "verified", "implemented", "specified", "approved_design", "proposed",
  "experimental", "deprecated", "unknown",
] as const);
export const SOURCE_AUTHORITIES = Object.freeze([
  "verification_evidence", "implementation", "normative", "approved_design",
  "canonical_docs", "research", "historical",
] as const);
export const CONFIDENCES = Object.freeze(["high", "medium", "low"] as const);
export const FRESHNESS_STATES = Object.freeze(["fresh", "aging", "stale", "unknown"] as const);
export const SOURCE_LIFECYCLES = Object.freeze(["current", "deprecated", "historical", "unknown"] as const);

export type Audience = (typeof AUDIENCES)[number];
export type AnswerDepth = (typeof DEPTHS)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type SourceAuthority = (typeof SOURCE_AUTHORITIES)[number];
export type Confidence = (typeof CONFIDENCES)[number];
export type KnowledgeFreshness = (typeof FRESHNESS_STATES)[number];
export type SourceLifecycle = (typeof SOURCE_LIFECYCLES)[number];

export interface BriefRequest {
  question: string;
  audience: Audience;
  depth: AnswerDepth;
}
export interface BriefEvidence {
  id: string;
  title: string;
  url: string | null;
  summary: string;
  sourceAuthority: SourceAuthority;
  lifecycle: SourceLifecycle;
  repository: string | null;
  path: string | null;
  revision: string | null;
  sourceHash: string | null;
}
export interface BriefKnowledge {
  sourceRevision: string | null;
  sourceHash: string | null;
  indexedAt: string | null;
  checkedAt: string | null;
  freshness: KnowledgeFreshness;
}
export interface BriefResponse {
  schemaVersion: typeof BRIEF_SCHEMA_VERSION;
  queryId: string;
  question: string;
  answer: { sayThis: string; followUp: string | null; caveats: string[] };
  classification: {
    claimStatus: ClaimStatus;
    confidence: Confidence;
    safeToGeneralize: boolean;
  };
  evidence: BriefEvidence[];
  knowledge: BriefKnowledge;
}

export class BriefValidationError extends Error {
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = "BriefValidationError";
    this.path = path;
  }
}
export type BriefParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: BriefValidationError };

function fail(path: string, reason: string): never {
  throw new BriefValidationError(path, reason);
}

/** All fields are required, including nullable unknowns; extra fields fail. */
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, "expected a JSON object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(path, "expected a plain JSON object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key)) {
      return fail(path, "unexpected field");
    }
    if (!("value" in descriptors[key]) || !descriptors[key].enumerable) {
      return fail(`${path}.${key}`, "expected an enumerable data field");
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return fail(`${path}.${key}`, "required field missing");
    }
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    return fail(path, `expected nonblank text of at most ${max} UTF-16 code units`);
  }
  return value;
}
function choice<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return fail(path, "unrecognized enum value");
  }
  return value as T;
}
function flag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "expected a boolean");
  return value;
}
function nullable<T>(value: unknown, path: string, parse: (value: unknown, path: string) => T): T | null {
  return value === null ? null : parse(value, path);
}
function list<T>(value: unknown, path: string, max: number, parse: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value) || value.length > max) return fail(path, `expected an array of at most ${max} entries`);
  if (Reflect.ownKeys(value).length !== value.length + 1) return fail(path, "unexpected array fields or holes");
  const result: T[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor)) return fail(`${path}[${i}]`, "expected a dense data array");
    result.push(parse(descriptor.value, `${path}[${i}]`));
  }
  return result;
}
function identifier(value: unknown, path: string): string {
  const result = text(value, path, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) return fail(path, "expected a bounded opaque identifier");
  return result;
}
function sourceHash(value: unknown, path: string): string {
  const result = text(value, path, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) return fail(path, "expected a lowercase SHA-256 digest");
  return result;
}
function revision(value: unknown, path: string): string {
  const result = text(value, path, 64);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result)) return fail(path, "expected a full immutable Git object id");
  return result;
}
function timestamp(value: unknown, path: string): string {
  const result = text(value, path, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result)) {
    return fail(path, "expected canonical UTC ISO time with milliseconds");
  }
  const date = new Date(result);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) return fail(path, "invalid calendar time");
  return result;
}
function sourceUrl(value: unknown, path: string): string {
  const result = text(value, path, 2048);
  if (!result.startsWith("https://") || result !== result.trim() || /[\s\\]/.test(result)) return fail(path, "invalid source URL");
  let url: URL;
  try { url = new URL(result); } catch { return fail(path, "invalid source URL"); }
  // The client may open this field. Private locators stay null, not clickable.
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search) {
    return fail(path, "expected an HTTPS citation without credentials or query parameters");
  }
  return result;
}
function repository(value: unknown, path: string): string {
  const result = text(value, path, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(result)) {
    return fail(path, "expected owner/repository");
  }
  return result;
}
function repositoryPath(value: unknown, path: string): string {
  const result = text(value, path, 1024);
  if (/[\\\x00-\x1f\x7f]/.test(result) || result.split("/").some((part) => !part || part === "." || part === "..")) {
    return fail(path, "expected a repository-relative path without traversal");
  }
  return result;
}
function evidence(value: unknown, path: string): BriefEvidence {
  const item = record(value, path, ["id", "title", "url", "summary", "sourceAuthority", "lifecycle", "repository", "path", "revision", "sourceHash"]);
  const parsed: BriefEvidence = {
    id: identifier(item.id, `${path}.id`),
    title: text(item.title, `${path}.title`, 300),
    url: nullable(item.url, `${path}.url`, sourceUrl),
    summary: text(item.summary, `${path}.summary`, 6000),
    sourceAuthority: choice(item.sourceAuthority, `${path}.sourceAuthority`, SOURCE_AUTHORITIES),
    lifecycle: choice(item.lifecycle, `${path}.lifecycle`, SOURCE_LIFECYCLES),
    repository: nullable(item.repository, `${path}.repository`, repository),
    path: nullable(item.path, `${path}.path`, repositoryPath),
    revision: nullable(item.revision, `${path}.revision`, revision),
    sourceHash: nullable(item.sourceHash, `${path}.sourceHash`, sourceHash),
  };
  if (parsed.path !== null && parsed.repository === null) return fail(path, "repository path requires repository identity");
  if (parsed.revision !== null && (parsed.repository === null || parsed.path === null)) {
    return fail(path, "Git evidence revision requires repository and path");
  }
  return parsed;
}
function knowledge(value: unknown, path: string): BriefKnowledge {
  const item = record(value, path, ["sourceRevision", "sourceHash", "indexedAt", "checkedAt", "freshness"]);
  const parsed: BriefKnowledge = {
    sourceRevision: nullable(item.sourceRevision, `${path}.sourceRevision`, revision),
    sourceHash: nullable(item.sourceHash, `${path}.sourceHash`, sourceHash),
    indexedAt: nullable(item.indexedAt, `${path}.indexedAt`, timestamp),
    checkedAt: nullable(item.checkedAt, `${path}.checkedAt`, timestamp),
    freshness: choice(item.freshness, `${path}.freshness`, FRESHNESS_STATES),
  };
  if (parsed.freshness !== "unknown" && (!parsed.sourceHash || !parsed.indexedAt || !parsed.checkedAt)) {
    return fail(path, "known freshness requires source hash, index time and check time");
  }
  if (parsed.indexedAt && parsed.checkedAt && parsed.checkedAt < parsed.indexedAt) {
    return fail(path, "freshness check predates the indexed snapshot");
  }
  return parsed;
}

export function parseBriefRequest(value: unknown): BriefRequest {
  const item = record(value, "request", ["question", "audience", "depth"]);
  return {
    question: text(item.question, "request.question", 2000),
    audience: choice(item.audience, "request.audience", AUDIENCES),
    depth: choice(item.depth, "request.depth", DEPTHS),
  };
}
export function parseBriefResponse(value: unknown): BriefResponse {
  const item = record(value, "response", ["schemaVersion", "queryId", "question", "answer", "classification", "evidence", "knowledge"]);
  const answer = record(item.answer, "response.answer", ["sayThis", "followUp", "caveats"]);
  const classification = record(item.classification, "response.classification", ["claimStatus", "confidence", "safeToGeneralize"]);
  const parsed: BriefResponse = {
    schemaVersion: choice(item.schemaVersion, "response.schemaVersion", [BRIEF_SCHEMA_VERSION]),
    queryId: identifier(item.queryId, "response.queryId"),
    question: text(item.question, "response.question", 2000),
    answer: {
      sayThis: text(answer.sayThis, "response.answer.sayThis", 6000),
      followUp: nullable(answer.followUp, "response.answer.followUp", (v, p) => text(v, p, 6000)),
      caveats: list(answer.caveats, "response.answer.caveats", 16, (v, p) => text(v, p, 2000)),
    },
    classification: {
      claimStatus: choice(classification.claimStatus, "response.classification.claimStatus", CLAIM_STATUSES),
      confidence: choice(classification.confidence, "response.classification.confidence", CONFIDENCES),
      safeToGeneralize: flag(classification.safeToGeneralize, "response.classification.safeToGeneralize"),
    },
    evidence: list(item.evidence, "response.evidence", 32, evidence),
    knowledge: knowledge(item.knowledge, "response.knowledge"),
  };
  const { claimStatus, confidence, safeToGeneralize } = parsed.classification;
  if (new Set(parsed.evidence.map((item) => item.id)).size !== parsed.evidence.length) {
    return fail("response.evidence", "duplicate evidence identifiers");
  }
  if (claimStatus === "unknown" && (confidence !== "low" || safeToGeneralize)) {
    return fail("response.classification", "unknown requires low confidence and no generalization");
  }
  if (claimStatus !== "unknown" && parsed.evidence.length === 0) {
    return fail("response.evidence", "known claim status requires evidence");
  }
  if (claimStatus === "verified" || claimStatus === "implemented") {
    const required = claimStatus === "verified" ? "verification_evidence" : "implementation";
    if (!parsed.evidence.some((item) => item.sourceAuthority === required && (item.revision !== null || item.sourceHash !== null))) {
      return fail("response.evidence", "implementation/verification requires matching pinned evidence metadata");
    }
  }
  if (safeToGeneralize && (
    ["unknown", "proposed", "experimental", "deprecated"].includes(claimStatus) ||
    parsed.knowledge.freshness !== "fresh" ||
    parsed.evidence.some((item) => item.lifecycle !== "current")
  )) {
    return fail("response.classification.safeToGeneralize", "generalization contradicts status or freshness metadata");
  }
  return parsed;
}

function schema<T>(parse: (value: unknown) => T) {
  return Object.freeze({
    parse,
    safeParse(value: unknown): BriefParseResult<T> {
      try { return { success: true, data: parse(value) }; }
      catch (error) {
        if (error instanceof BriefValidationError) return { success: false, error };
        throw error;
      }
    },
  });
}
export const briefRequestSchema = schema(parseBriefRequest);
export const briefResponseSchema = schema(parseBriefResponse);
