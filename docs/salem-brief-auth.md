# Salem Quick Answer read credential

Tracking: OpenCoven/coven-cave#5328 under #5323.

`POST /api/brief` uses a dedicated read-only credential with the conceptual scope `salem.brief.read`. It is intentionally separate from `SALEM_ADMIN_PASSWORD`, reindex secrets, provider credentials, private-research credentials, and all OpenCoven protected authority.

## Credential material

The native client receives one high-entropy bearer token and stores the raw token in macOS Keychain. Salem does **not** store that raw bearer. The server stores only its lowercase SHA-256 verifier:

```sh
TOKEN="$(openssl rand -hex 32)"
printf '%s' "$TOKEN" | shasum -a 256
```

Configure the 64-character digest as:

```text
SALEM_BRIEF_READ_TOKEN_SHA256=<sha256-of-token>
```

Deliver `$TOKEN` to the authorized client through an operator-controlled channel, then discard any temporary plaintext copy. Do not put the raw token in source, logs, URLs, public environment variables, issue comments, or analytics.

The client sends:

```http
Authorization: Bearer <raw-token>
```

## Revocation

Rotate `SALEM_BRIEF_READ_TOKEN_SHA256` to a new verifier to invalidate the previous active credential. For an explicit revoked state during transition/incident handling, add old digests to the comma-separated server-only list:

```text
SALEM_BRIEF_REVOKED_TOKEN_SHA256S=<old-sha256>,<another-old-sha256>
```

A token matching the revoked set is rejected even if its digest is accidentally still configured as active.

## Failure semantics

| Condition | HTTP | Code |
|---|---:|---|
| verifier absent or malformed | 503 | `BRIEF_AUTH_NOT_CONFIGURED` |
| Authorization missing | 401 | `BRIEF_AUTH_MISSING` |
| bearer syntax/length malformed | 401 | `BRIEF_AUTH_MALFORMED` |
| digest does not match active verifier | 401 | `BRIEF_AUTH_UNAUTHORIZED` |
| digest is explicitly revoked | 403 | `BRIEF_AUTH_REVOKED` |

Authentication occurs before retrieval, freshness reads, or model generation.

## Rate limiting

Authenticated Quick Answer requests use a separate `opencoven-brief` Upstash namespace with a 30-request sliding window per 60 seconds. The limiter key is derived from the non-secret token fingerprint plus client IP; the raw bearer never becomes a Redis key.

The existing public chat limiter remains `opencoven-chat` at its current 10 requests per 60 seconds. This slice does not relax or consume that quota.

## Authority boundary

The credential authorizes **only** the Brief read endpoint. It is not a generic Salem principal and is not accepted by chat follow-up/admin, docs reindex, webhook administration, private-source management, Threads, Coven, Psyche, memory mutation, GitHub write, deployment, or release surfaces.

This v0.1 mechanism is deliberately small. A later Cave pairing integration may replace how the credential is issued, but it must preserve the same least-privilege read scope and revocation semantics rather than turning the Quick Answer token into ambient OpenCoven authority.
