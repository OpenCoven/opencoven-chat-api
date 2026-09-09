# Salem Quick Answer native-client auth

Tracking: OpenCoven/coven-cave#5328 under #5323.

## Scope

`POST /api/brief` is a read-only Salem surface for the Cave-owned macOS Quick Answer client. The client credential grants one capability only:

`salem.brief.read`

It does not grant Salem admin access, reindex access, private-source management, docs mutation, Threads proposal/commit authority, Coven execution, memory writes, GitHub writes, release authority, or publication authority.

## Client credential

The native client receives one random bearer token out-of-band during the current maintainer-only v0.1 flow. The Mac stores the raw token in Keychain and sends:

```http
Authorization: Bearer <raw-token>
```

The server stores/configures only the lowercase SHA-256 digest in `SALEM_BRIEF_CLIENT_TOKEN_SHA256`. Multiple comma-separated digests are allowed for bounded rotation.

The raw token must not be placed in source, app resources, plist files, shell history, analytics, crash metadata, or public logs.

## Revocation

A token is rejected when its digest appears in `SALEM_BRIEF_CLIENT_REVOKED_SHA256`, even if the digest is still present in the active set. Removing an active digest also invalidates the token. This is deliberately simple for the maintainer-only v0.1 surface and should later align with Cave's normal native-client pairing/revocation model rather than become a second durable account system.

## Fail-closed states

- active digest set absent/invalid: `503 BRIEF_AUTH_NOT_CONFIGURED`
- no bearer: `401 BRIEF_AUTH_REQUIRED`
- malformed bearer: `401 BRIEF_AUTH_MALFORMED`
- unknown digest: `401 BRIEF_AUTH_INVALID`
- revoked digest: `401 BRIEF_AUTH_REVOKED`

401 responses advertise the `salem.brief.read` bearer scope. No auth failure falls through to retrieval or model execution.

## Rate limiting

Authenticated Brief requests use a separate Upstash namespace (`opencoven-brief`) and a 30 requests / 60 seconds sliding window, keyed by the hashed credential fingerprint plus client IP. Public chat keeps its existing `opencoven-chat` 10 / 60 second budget. Missing Redis configuration preserves the repository's existing behavior of disabling rate limiting; authentication still remains mandatory.

## Secrets that never go to the client

The Mac must never receive:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `COHERE_API_KEY`
- Upstash credentials
- GitHub private-research credentials
- `SALEM_ADMIN_PASSWORD`
- `REINDEX_SECRET`
- `GITHUB_WEBHOOK_SECRET`

## Rotation / recovery

1. Generate a new random raw token.
2. Compute its SHA-256 digest.
3. Add the new digest to the active server set.
4. Replace the raw token in the Mac Keychain.
5. Verify `/api/brief` with the new credential.
6. Add the old digest to the revoked set or remove it from active configuration.

No protected OpenCoven authority is transferred by this credential.
