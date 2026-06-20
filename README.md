# Salem Docs Assistant API

![Salem Docs Assistant](public/og-image.png)

AI-powered documentation chatbot API for [OpenCoven](https://opencoven.ai). Salem helps people navigate OpenCoven documentation through natural conversation.

## Overview

This API serves Salem, the OpenCoven docs and pathfinding assistant. It uses RAG (Retrieval-Augmented Generation) to:

1. Index OpenCoven documentation into a vector store
2. Retrieve relevant docs based on user questions
3. Stream AI-generated answers grounded in the documentation

The OpenCoven documentation source is `https://docs.opencoven.ai/llms-full.txt`.
Authorized deployments can also index private OpenCoven research from server-only private sources without exposing those papers through public docs.

## Stack

- **Framework**: [Next.js](https://nextjs.org) 16 with Edge Runtime
- **Runtime**: [Bun](https://bun.sh)
- **Deployment**: [Vercel](https://vercel.com) Edge Functions
- **Vector Store**: [Upstash Vector](https://upstash.com/vector)
- **Rate Limiting / BM25 Index**: [Upstash Redis](https://upstash.com/redis)
- **AI**: OpenAI for chat completions, Gemini for embeddings, optional Cohere reranking
- **Language**: TypeScript

## API Endpoints

| Endpoint              | Method | Description                               |
| --------------------- | ------ | ----------------------------------------- |
| `/api/chat`           | POST   | Send a question, get a streaming response |
| `/api/health`         | GET    | Health check                              |
| `/api/webhook`        | POST   | GitHub docs webhook for re-indexing       |
| `/api/cron/reindex`   | POST   | Protected scheduled re-index safety net   |

### POST /api/chat

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
| `SALEM_ADMIN_PASSWORD`      | No       | Server-only password required for follow-up conversations after the first website question |
| `SALEM_PRIVATE_RESEARCH_DOCS_BASE64` | No | Base64-encoded private research markdown to include in Salem's index |
| `SALEM_PRIVATE_RESEARCH_REPO` | No | Private GitHub repo for research sources, for example `OpenCoven/coven-research` |
| `SALEM_PRIVATE_RESEARCH_REF` | No | Git ref for private research sources, defaults to `main` |
| `SALEM_PRIVATE_RESEARCH_PATHS` | No | Comma-separated private research markdown paths |
| `SALEM_PRIVATE_RESEARCH_GITHUB_TOKEN` | No | Server-only token for private GitHub research fetches |
| `ALLOWED_ORIGINS`           | No       | Comma-separated CORS allowlist                   |

`SALEM_ADMIN_PASSWORD` is intentionally not exposed through any `PUBLIC_` or `NEXT_PUBLIC_` variable. Follow-up requests fail closed when this env var is missing; there is no fallback password.

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
| `bun run dev`         | Start development server              |
| `bun run build`       | Build for production                  |
| `bun run start`       | Start production server               |
| `bun run test`        | Validate OpenCoven/Salem port wiring  |
| `bun run build:index` | Index documentation into vector store |
| `bun run deploy`      | Deploy to Vercel                      |

## Automatic Documentation Updates

The API supports automatic re-indexing when documentation changes are pushed to the docs repository's main branch, plus a protected scheduled safety net for missed webhooks or docs deploy timing races.

1. A push is made to the main branch of the docs repository.
2. GitHub sends a webhook payload to `/api/webhook`.
3. The API verifies the signature, fetches `https://docs.opencoven.ai/llms-full.txt` plus configured private research sources, hashes the combined source text, and skips re-indexing when the content is unchanged.
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
