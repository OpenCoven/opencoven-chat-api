# Salem Docs Assistant API

![Salem Docs Assistant](public/og-image.png)

AI-powered documentation chatbot API for [OpenCoven](https://opencoven.ai). Salem helps people navigate OpenCoven documentation through natural conversation.

## Overview

This API serves Salem, the OpenCoven docs and pathfinding assistant. It uses RAG (Retrieval-Augmented Generation) to:

1. Index OpenCoven documentation into a vector store
2. Retrieve relevant docs based on user questions
3. Stream AI-generated answers grounded in the documentation

Public documentation sources are `https://docs.opencoven.ai/llms-full.txt` and `https://docs.typesafe.ai/llms-full.txt`.
Authorized deployments can also index private OpenCoven research from server-only private sources without exposing those papers through public docs.

## Stack

- **Framework**: [Next.js](https://nextjs.org) 16 with Edge Runtime
- **Runtime**: [Bun](https://bun.sh)
- **Deployment**: [Vercel](https://vercel.com) Edge Functions
- **Vector Store**: [Upstash Vector](https://upstash.com/vector)
- **Rate Limiting / BM25 Index**: [Upstash Redis](https://upstash.com/redis)
- **AI**: OpenAI for chat completions, Gemini for embeddings, optional Cohere reranking
- **Language**: TypeScript

## Access and recent chats

Salem requires sign-in before showing the chat interface or accepting any question.
The existing `SALEM_ADMIN_PASSWORD` signs in to the `admin` account (override its
username with `SALEM_ADMIN_USERNAME`). The former public first-question access and
`X-Salem-Admin-Password` API header are no longer supported.

Additional users must be explicitly provisioned in the server-only
`SALEM_USERS_JSON` environment variable. There is no public registration. Each user
has a unique lowercase ID and individual password; users can only view and
continue their own conversations. Do not share accounts or reuse a departed
user's ID for someone else.

To create a user entry, pipe a password of at least 12 characters from a password
manager into `bun run user:hash alice "Alice"`. The command reads stdin without
printing the password and outputs an entry containing a salted password hash.
Collect approved entries in a JSON array and set `SALEM_USERS_JSON` in Vercel:

```json
[{"id":"alice","name":"Alice","passwordHash":"<generated hash>","privateSources":false}]
```

Set `privateSources` to `true` only for users permitted to access private research.
The initial admin account retains private research access. Removing a user or
changing their password or private-source permission invalidates existing sessions.
Deploy the environment changes to apply them.

Sessions use an HttpOnly, SameSite=Strict cookie (Secure in production), expire
after 12 hours, and are revoked on sign-out. Redis is required for sessions and
history; storage failures never allow anonymous access. Login attempts are limited
to 10 per IP per 15 minutes.

Recent chats are stored in Redis under the authenticated user, retaining the latest
20 conversations, up to 40 messages each, for 30 days after the last completed
reply. Reopen a recent chat to continue it, or choose **New chat**. Interrupted or
unsaved replies produce an error and are not added to the saved conversation.
Chats from before this feature cannot be recovered because they were not stored.

## API Endpoints

Salem is a **first-party, session-only API**: it serves its own UI and no other
client. There is no CORS allowlist and no preflight handler, because there is no
supported cross-origin caller. `/api/chat`, `/api/chats` and `/api/chats/[id]`
require a `salem_session` cookie and reject cross-site requests outright.

Support for the Coven Cave client (which proxied to `SALEM_CHAT_API_URL`) was
removed. Integrating an external client again would need a deliberate
server-to-server auth path — a bearer token or service credential — rather than
the browser session cookie, which is `SameSite=Strict` and cannot be forwarded
by a proxy.

| Endpoint              | Method | Description                               |
| --------------------- | ------ | ----------------------------------------- |
| `/api/session`        | POST / GET / DELETE | Sign in, inspect session, or sign out |
| `/api/chats`          | GET    | List the signed-in user's recent chats |
| `/api/chats/[id]`     | GET    | Read one of the signed-in user's chats |
| `/api/chat`           | POST   | Ask a question using an authenticated session |
| `/api/health`         | GET    | Health check                              |
| `/api/webhook`        | POST   | GitHub docs webhook for re-indexing       |
| `/api/cron/reindex`   | POST   | Protected scheduled re-index safety net   |

### POST /api/chat

First sign in through `/api/session` with `{ "username": "admin", "password": "..." }`
and retain the session cookie. Send `chatId` to continue a saved conversation;
omit it to start a new one. The API returns the ID in `X-Chat-Id` and loads prior
messages from storage. Caller-supplied user IDs and message history are ignored.

```json
{
  "message": "How do I get started with OpenCoven?"
}
```

Returns a streaming `text/plain` response with an AI-generated answer grounded in OpenCoven documentation.

**Rate Limit Headers:**

- `X-RateLimit-Limit` - Maximum requests allowed
- `X-RateLimit-Remaining` - Requests remaining in window
- `X-RateLimit-Reset` - Timestamp when the limit resets

**Debug Headers:**

- `X-Query-Id`
- `X-Best-Score`
- `X-Low-Confidence`
- `X-Result-Count`
- `X-Strategy`
- `X-Intent`
- `X-Retrieval-Ms`
- `X-Rerank-Ms`
- `X-Relevance-Rank`

No persistent query analytics or feedback endpoint is included.

## Setup

1. Install dependencies:

```sh
bun install
```

2. Copy `.env.example` to `.env` and fill in your credentials:

```sh
cp .env.example .env
```

### Environment Variables

| Variable                    | Required | Description                                      |
| --------------------------- | -------- | ------------------------------------------------ |
| `OPENAI_API_KEY`            | Yes      | OpenAI key for streaming chat completions and primary embeddings |
| `GEMINI_API_KEY`            | No       | Gemini key for embeddings when OpenAI is unavailable |
| `EMBEDDINGS_PROVIDER`       | No       | Force `openai` or `gemini`; defaults to OpenAI when available |
| `UPSTASH_VECTOR_REST_URL`   | Yes      | Upstash Vector endpoint                          |
| `UPSTASH_VECTOR_REST_TOKEN` | Yes      | Upstash Vector auth token                        |
| `UPSTASH_REDIS_REST_URL`    | Yes      | Upstash Redis endpoint for rate limits and BM25  |
| `UPSTASH_REDIS_REST_TOKEN`  | Yes      | Upstash Redis auth token                         |
| `COHERE_API_KEY`            | No       | Cohere key for reranking                         |
| `GITHUB_WEBHOOK_SECRET`     | No       | Secret for GitHub webhook                        |
| `REINDEX_SECRET`            | No       | Secret for scheduled re-index endpoint           |
| `SALEM_ADMIN_PASSWORD`      | Yes, unless named users are configured | Password for the initial admin account. Legacy: see the note below |
| `SALEM_ADMIN_USERNAME`      | No       | Initial admin username, defaults to `admin` |
| `SALEM_USERS_JSON`          | No       | Approved named users with password hashes and optional private research permission |
| `SALEM_PRIVATE_RESEARCH_DOCS_BASE64` | No | Base64-encoded private research markdown to include in Salem's index |
| `SALEM_PRIVATE_RESEARCH_REPO` | No | Private GitHub repo for research sources, for example `your-org/your-private-research` |
| `SALEM_PRIVATE_RESEARCH_REF` | No | Git ref for private research sources, defaults to `main` |
| `SALEM_PRIVATE_RESEARCH_PATHS` | No | Comma-separated private research markdown paths |
| `SALEM_PRIVATE_RESEARCH_GITHUB_TOKEN` | No | Server-only token for private GitHub research fetches |

Authentication variables are server-only. Never expose them through `PUBLIC_` or `NEXT_PUBLIC_` variables. Without a configured admin or approved user list, the interface stays locked.

> **Prefer `SALEM_USERS_JSON` over `SALEM_ADMIN_PASSWORD`.** The admin variable is a
> legacy path: it is compared as an unsalted single-round SHA-256 of the plaintext,
> while every account in `SALEM_USERS_JSON` uses PBKDF2-SHA256 at 600,000 iterations.
> It is also the only account that is granted private-research access unconditionally,
> so it is simultaneously the highest-privilege credential and the weakest-hashed one.
> Mint a replacement with `bun run user:hash <id> "<name>"`, add it to
> `SALEM_USERS_JSON` with `privateSources: true`, then unset `SALEM_ADMIN_PASSWORD`.
> Removing it invalidates any live session issued against it, which is the intent.

Private research variables are also server-only. If `SALEM_PRIVATE_RESEARCH_DOCS_BASE64` is set, Salem indexes that markdown directly. If `SALEM_PRIVATE_RESEARCH_REPO` and `SALEM_PRIVATE_RESEARCH_PATHS` are set, Salem fetches those private Markdown files through the GitHub Contents API using `SALEM_PRIVATE_RESEARCH_GITHUB_TOKEN`.

3. Build the vector index:

```sh
bun run build:index
```

## Development

```sh
bun run dev
```

Runs locally at http://localhost:3000.

## Scripts

| Script                | Description                           |
| --------------------- | ------------------------------------- |
| `bun run dev`         | Start development server (port 3000)  |
| `bun run build`       | Build for production                  |
| `bun run start`       | Start production server               |
| `bun run typecheck`   | Type-check with `tsc --noEmit`        |
| `bun run test`        | Run the full offline test suite       |
| `bun run build:index` | Index documentation into vector store |
| `bun run user:hash`   | Hash a password for `SALEM_USERS_JSON` |
| `bun run deploy`      | Deploy to Vercel                      |

### Pre-commit checks

This repository is public, so "no secrets in git" is enforced rather than assumed.
`bun install` installs [lefthook](https://github.com/evilmartians/lefthook) hooks via
the `prepare` script:

- **pre-commit** — `gitleaks` on the staged patch, a guard that refuses
  credential-bearing paths even when force-added past `.gitignore`, and `tsc`.
- **pre-push** — the test suite.

The same checks run in `.github/workflows/ci.yml`, because `git commit --no-verify`
skips local hooks. If gitleaks flags a false positive, add a narrow entry to
`[allowlist]` in `.gitleaks.toml` rather than disabling the hook.

## Automatic Documentation Updates

The API supports automatic re-indexing when documentation changes are pushed to the docs repository's main branch, plus a protected scheduled safety net for missed webhooks or docs deploy timing races.

1. A push is made to the main branch of the docs repository.
2. GitHub sends a webhook payload to `/api/webhook`.
3. The API verifies the signature, fetches the OpenCoven and TypeSafe documentation feeds plus configured private research sources, hashes the combined source text, and skips re-indexing when the content is unchanged.
4. When the hash changed, Salem chunks the content, generates embeddings, replaces the vector store, rebuilds BM25, and stores the new source hash in Upstash Redis.

### Scheduled Re-index

Configure QStash or another scheduler to call the protected endpoint periodically:

```sh
curl -X POST "https://salem.opencoven.ai/api/cron/reindex" \
  -H "Authorization: Bearer $REINDEX_SECRET"
```

Use `?force=1` only for manual recovery when you need to rebuild the index even if `llms-full.txt` has the same hash:

```sh
curl -X POST "https://salem.opencoven.ai/api/cron/reindex?force=1" \
  -H "Authorization: Bearer $REINDEX_SECRET"
```

The scheduler should run after docs publishing has had time to update `https://docs.opencoven.ai/llms-full.txt`. A daily schedule is usually enough; every few hours is reasonable while docs are changing quickly.

## License

MIT
