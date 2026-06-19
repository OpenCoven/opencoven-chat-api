import assert from "node:assert/strict";
import { Embeddings } from "../rag/embeddings";

const originalFetch = globalThis.fetch;
const originalOpenAI = process.env.OPENAI_API_KEY;
const originalGemini = process.env.GEMINI_API_KEY;
const originalProvider = process.env.EMBEDDINGS_PROVIDER;

function vector(seed: number): number[] {
  return Array.from({ length: 3072 }, (_, index) => seed + index);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

try {
  {
    const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: input.toString(),
        body: init?.body ? JSON.parse(init.body.toString()) : null,
        auth: headers.get("Authorization"),
      });

      return jsonResponse({
        data: [
          { index: 0, embedding: vector(1) },
          { index: 1, embedding: vector(2) },
        ],
      });
    }) as typeof fetch;

    process.env.OPENAI_API_KEY = "openai-test";
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.EMBEDDINGS_PROVIDER;

    const embeddings = Embeddings.fromEnv();
    const result = await embeddings.embedBatch(["first", "second"]);

    assert.equal(embeddings.provider, "openai");
    assert.equal(embeddings.dimensions, 3072);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.com/v1/embeddings");
    assert.equal(calls[0].auth, "Bearer openai-test");
    assert.deepEqual(calls[0].body, {
      model: "text-embedding-3-large",
      input: ["first", "second"],
    });
    assert.deepEqual(result, [vector(1), vector(2)]);
  }

  {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(input.toString());
      return jsonResponse({
        embeddings: [{ values: vector(3) }],
      });
    }) as typeof fetch;

    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = "gemini-test";
    delete process.env.EMBEDDINGS_PROVIDER;

    const embeddings = Embeddings.fromEnv();
    const result = await embeddings.embedBatch(["fallback"]);

    assert.equal(embeddings.provider, "gemini");
    assert.match(calls[0], /gemini-embedding-001:batchEmbedContents/);
    assert.deepEqual(result, [vector(3)]);
  }

  {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.EMBEDDINGS_PROVIDER;

    assert.throws(
      () => Embeddings.fromEnv(),
      /OPENAI_API_KEY or GEMINI_API_KEY is required/,
    );
  }
} finally {
  globalThis.fetch = originalFetch;

  if (originalOpenAI === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAI;
  }

  if (originalGemini === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalGemini;
  }

  if (originalProvider === undefined) {
    delete process.env.EMBEDDINGS_PROVIDER;
  } else {
    process.env.EMBEDDINGS_PROVIDER = originalProvider;
  }
}

console.log("embeddings: ok");
