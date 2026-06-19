# Salem Docs Assistant API

![Salem Docs Assistant](public/og-image.png)

AI-powered documentation chatbot API for [OpenCoven](https://opencoven.ai). Salem helps people navigate OpenCoven documentation through natural conversation.

## Overview

This API serves Salem, the OpenCoven docs and pathfinding assistant. It uses RAG (Retrieval-Augmented Generation) to:

1. Index OpenCoven documentation into a vector store
2. Retrieve relevant docs based on user questions
3. Stream AI-generated answers grounded in the documentation

The OpenCoven documentation source is `https://docs.opencoven.ai/llms-full.txt`.

## Stack

- **Framework**: [Next.js](https://nextjs.org) 16 with Edge Runtime
- **Runtime**: [Bun](https://bun.sh)
- **Deployment**: [Vercel](https://vercel.com) Edge Functions
- **Vector Store**: [Upstash Vector](https://upstash.com/vector)
- **Rate Limiting / BM25 Index**: [Upstash Redis](https://upstash.com/redis)
- **AI**: OpenAI for chat completions, Gemini for embeddings, optional Cohere reranking
- **Language**: TypeScript

## API Endpoints

| Endpoint       | Method | Description                               |
| -------------- | ------ | ----------------------------------------- |
| `/api/chat`    | POST   | Send a question, get a streaming response |
| `/api/health`  | GET    | Health check                              |
| `/api/webhook` | POST   | GitHub docs webhook for re-indexing       |

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
| `GEMINI_API_KEY`            | Yes      | Gemini API key for embeddings                    |
| `OPENAI_API_KEY`            | Yes      | OpenAI API key for streaming chat completions    |
| `UPSTASH_VECTOR_REST_URL`   | Yes      | Upstash Vector endpoint                          |
| `UPSTASH_VECTOR_REST_TOKEN` | Yes      | Upstash Vector auth token                        |
| `UPSTASH_REDIS_REST_URL`    | Yes      | Upstash Redis endpoint for rate limits and BM25  |
| `UPSTASH_REDIS_REST_TOKEN`  | Yes      | Upstash Redis auth token                         |
| `COHERE_API_KEY`            | No       | Cohere key for reranking                         |
| `GITHUB_WEBHOOK_SECRET`     | No       | Secret for GitHub webhook                        |
| `ALLOWED_ORIGINS`           | No       | Comma-separated CORS allowlist                   |

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

The API supports automatic re-indexing when documentation changes are pushed to the docs repository's main branch.

1. A push is made to the main branch of the docs repository.
2. GitHub sends a webhook payload to `/api/webhook`.
3. The API verifies the signature, fetches `https://docs.opencoven.ai/llms-full.txt`, chunks the content, generates embeddings, and replaces the vector store.

## License

MIT
