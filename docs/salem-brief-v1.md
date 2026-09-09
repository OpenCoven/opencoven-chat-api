# Salem Brief v1 wire contract

Tracking: OpenCoven/coven-cave#5325, under #5323. Implementation owner: Salem in
`OpenCoven/opencoven-chat-api`; Cave owns the consuming macOS product. This is a
**schema-only** slice: no `/api/brief` endpoint, auth, retrieval, model call,
index migration, UI, or `/api/chat` behavior is introduced.

## Canonical implementation and usage

`rag/brief-contract.ts` exports the TypeScript types, enum tables,
`parseBriefRequest`, `parseBriefResponse`, `briefRequestSchema`, and
`briefResponseSchema`. It follows the repository's dependency-free runtime
validation pattern. There is no second schema library or generated type copy.

```ts
import { briefResponseSchema } from "../rag/brief-contract";

const result = briefResponseSchema.safeParse(untrustedJson);
if (!result.success) {
  // Show a typed failure. Do not salvage answer text from the invalid payload.
  throw result.error;
}
const brief = result.data;
```

`parse` throws `BriefValidationError`; `safeParse` returns a discriminated
success/data or failure/error union for invalid contract data. Unexpected
programming errors are rethrown, not hidden as an empty successful answer.
Errors contain a field path and a fixed reason, not the offending value.

All object fields below are required. A nullable field must be explicitly
`null` when unknown; omission, `undefined`, coercion, unknown enum values, extra
fields, inherited fields, and accessor properties fail closed. No defaults,
truncation, inferred statuses, or whitespace rewrites are applied. Returned
objects/arrays are copies, not aliases of unvalidated input.

## Request

```json
{"question":"What is a familiar?","audience":"anyone","depth":"conversation"}
```

- `question`: nonblank string, at most 2,000 UTF-16 code units (matching the
  existing chat question bound).
- `audience`: `anyone`, `ai_user`, `creator`, `developer`, `security`, `partner`.
  `partner` includes partner/investor presentation, not special access.
- `depth`: `quick`, `conversation`, `deep`, `technical`.

The request has **no authority fields**: no model/retrieval override, evidence
status, system prompt, private-source switch, credential, or scope. Selecting an
 audience or depth grants no access. Authentication and request byte limits
belong to the future route, not this parser.

## Response

Required root keys:

| Field | Contract |
| --- | --- |
| `schemaVersion` | Exact literal `opencoven.salem-brief/v1` |
| `queryId` | Nonblank opaque ID; ASCII alphanumeric first, then alphanumeric, `.`, `_`, `:`, `-`; max 128 |
| `question` | Same string bound as request; correlation with the submitted question is a caller responsibility |
| `answer` | `sayThis`, `followUp`, `caveats` |
| `classification` | `claimStatus`, `confidence`, `safeToGeneralize` |
| `evidence` | At most 32 evidence records with unique IDs |
| `knowledge` | Snapshot identity and explicit freshness metadata |

`answer.sayThis` is nonblank text, at most 6,000 UTF-16 code units.
`answer.followUp` is nonblank text with the same bound, or `null` when absent.
`answer.caveats` is a dense array of at most 16 nonblank strings, each at most
2,000 UTF-16 code units. Empty caveats are valid. These are transport ceilings,
not spoken-length targets; brevity and material-caveat coverage belong to #5327.

## Claim status is not confidence or a numerical rank

| `claimStatus` | Meaning of the producer's declaration |
| --- | --- |
| `verified` | Supported by execution/acceptance evidence for a stated scope |
| `implemented` | Present in a particular implementation; not automatically release or runtime verification |
| `specified` | Defined in a normative specification; not proof it exists in software |
| `approved_design` | An accepted design with implementation/evidence potentially incomplete |
| `proposed` | Under consideration, not accepted or shipped |
| `experimental` | Experimental scope; not generally supported |
| `deprecated` | Superseded/historical behavior, not current support |
| `unknown` | Insufficient evidence for a stronger statement |

There is no ordinal ordering or promotion helper. `specified != implemented`,
`implemented != verified`, `experimental != supported`, and `proposed != shipped`.
A high-confidence specification is still a specification. Freshness is another
independent dimension: a high-confidence answer may have stale evidence.

`confidence` is exactly `high | medium | low`, **not a calibrated probability**
and not an independently verified fact. `safeToGeneralize` is a conservative
producer assertion about the answer's explicitly supported scope, never
permission, certification, or universal model/provider support. A value of
`true` does not allow a client to remove caveats or enlarge the claim's scope.

Minimal structural consistency checks:

- Non-`unknown` status requires nonempty evidence.
- `unknown` requires `confidence: low` and `safeToGeneralize: false`. It may
  retain related evidence without pretending that evidence answers the question.
- `verified` needs at least one `verification_evidence` record with an immutable
  revision or source hash. `implemented` needs an equivalently pinned
  `implementation` record. A specification alone cannot meet either check.
- `safeToGeneralize: true` is rejected for unknown, proposed, experimental, or
  deprecated status, non-fresh knowledge, or non-current evidence lifecycle.

**These checks validate declarations, not their truth.** An attacker can label
arbitrary text `verification_evidence`; a syntactically valid hash does not
prove the document exists or supports the answer. Matching metadata is only a
necessary structural condition. Source authentication, operation-specific
authority, semantic entailment, claim-by-claim grounding, conflicts, privacy,
and release-readiness evaluation remain downstream gates in #5327/#5328.

The aggregate status must not be used to imply that mixed-maturity sentences
share the strongest status. The producer must bound the answer to a consistent
claim scope or return `unknown` until it can represent the distinction safely.

## Source authority and provenance

Each evidence record requires:

| Field | Type / bound |
| --- | --- |
| `id` | Same identifier format as `queryId`; unique within the response |
| `title` | Nonblank text, max 300 UTF-16 code units |
| `summary` | Nonblank excerpt or evidence summary, max 6,000 |
| `sourceAuthority` | One of the seven metadata values below |
| `lifecycle` | `current`, `deprecated`, `historical`, `unknown` |
| `url` | HTTPS citation max 2,048, or `null` |
| `repository` | `owner/repository` max 200, or `null` |
| `path` | Repository-relative path max 1,024, or `null` |
| `revision` | Full lowercase 40- or 64-hex Git object ID, or `null` |
| `sourceHash` | Lowercase 64-hex SHA-256 of the source snapshot, or `null` |

Source taxonomy:

| Value | Describes |
| --- | --- |
| `verification_evidence` | Execution, test, or acceptance observation |
| `implementation` | Source code at a particular revision |
| `normative` | Normative specification |
| `approved_design` | Accepted design decision |
| `canonical_docs` | Canonical explanatory documentation |
| `research` | Research or exploratory material |
| `historical` | Retained historical material |

This is evidence metadata, **not** a new identity root, source of protected
authority, or replacement for canonical repository ownership. A Cave README
cannot redefine Familiar Contract semantics. Status is never inferred solely
from one of these strings.

Moving branch/tag labels such as `main`, abbreviated commit IDs, timestamps,
or titles are not accepted as immutable revisions. A Git revision requires a
repository and path; a path requires a repository. Paths cannot be absolute,
contain backslashes/control characters, or include empty/`.`/`..` segments.
Sources without Git provenance may use a content hash; unknown provenance must
remain `null`, not a fabricated SHA. A corpus hash is not a per-source proof.

URLs are navigation metadata only. Credentials, query parameters, whitespace,
backslashes, non-HTTPS protocols, and `private://` locators are rejected. Private
or undisclosable locators use `url: null`; authorization/redaction must happen
**before** a record reaches this contract. HTTPS syntax alone does not make a
host trusted. This module never fetches or opens a URL and never grants private
access. Consumers must apply their own source trust and navigation policy.

## Knowledge identity and freshness

All five fields are required:

- `sourceRevision`: full immutable Git ID or `null` (e.g. no single Git revision
  exists for a multi-source corpus).
- `sourceHash`: lowercase 64-hex SHA-256 of the indexed corpus, or `null`.
- `indexedAt`: canonical UTC ISO timestamp with milliseconds, or `null`.
- `checkedAt`: timestamp of the producer's successful freshness assessment for
  this snapshot, or `null`.
- `freshness`: `fresh | aging | stale | unknown`.

Canonical time example: `2026-09-08T12:05:00.000Z`. Invalid calendar dates and
noncanonical offset/precision forms are rejected. `checkedAt` cannot predate
`indexedAt`. Any non-`unknown` freshness needs a hash and both timestamps;
otherwise the producer must report `unknown`.

`fresh` means the producer's applicable policy established currentness; `aging`
means its warning threshold was reached; `stale` means it detected an outdated
snapshot or exceeded its freshness limit; `unknown` means it cannot establish
currentness. Thresholds are deployment policy, not constants in this module.
The parser does not consult the clock, repository, index, or network.

The existing index state contains `docsHash` and `indexedAt`; the heartbeat has
`checkedAt`. Those are integration inputs, not an automatic mapping to `fresh`.
A recently rebuilt old corpus is not proof of current implementation. Reindex
failure, missing provenance, or heartbeat alone cannot establish release state.

## Insufficient evidence is a successful result

`scripts/fixtures/salem-brief-v1.json` includes a complete `unknown` response with
`sayThis: "I wouldn't claim that yet."`, empty evidence, low confidence, false
generalization, and unknown/null knowledge. This is a successful parse, unlike a
malformed response or transport/authentication error. It does not assert that a
feature is absent; only that evidence is insufficient. The route must never
convert malformed metadata to this successful result while keeping unsupported
answer prose.

The `specified` example is entirely synthetic (`example.com`, `example/fixture`,
synthetic digests). It is test data, **not OpenCoven implementation evidence**.
Negative fixtures cover partial metadata, wrong versions, type coercion,
unsupported status, spec-only verification, moving revisions, and false freshness.

## Verification and compatibility

From the repository root:

```sh
bun run test:brief
bun run test
bunx tsc --noEmit
```

The narrow command is also appended to the existing test chain without removing
any check. It needs no model, credentials, Redis, network, or live Salem service.
Tests include runtime rejection, valid round trips, TypeScript negative type
assertions, evidence/freshness consistency, and explicit unknown outcomes.
Type assertions require `tsc`; executing TypeScript alone is not typechecking.

Consumers must pin the producer commit/fixture version before integrating. There
is no automatic version fallback: malformed or different versions are rejected.
Because unknown fields are rejected, expanding this wire shape or its enums
requires an explicit coordinated version change rather than silently altering
v1. #5326 can consume this inert module for retrieval metadata shaping; #5327
owns actual answer policy; #5328 owns auth; #5329 can use the synthetic fixtures
without a live service. No dependency or lockfile change is required here.
