/**
 * Embeddings wrapper for docs-chat RAG pipeline.
 * Provides single and batch embedding generation.
 *
 * OpenAI text-embedding-3-large and Gemini gemini-embedding-001 both produce
 * 3072-dimensional vectors, so either provider fits the same Upstash Vector
 * schema. Salem chooses one provider deterministically so indexed docs and
 * query embeddings stay in the same embedding space.
 */

type EmbeddingsProvider = "openai" | "gemini";

interface EmbeddingsOptions {
  openaiApiKey?: string;
  geminiApiKey?: string;
  provider?: "auto" | EmbeddingsProvider;
  openaiModel?: string;
  geminiModel?: string;
}

const DEFAULT_OPENAI_MODEL = "text-embedding-3-large";
const DEFAULT_GEMINI_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-large": 3072,
  "gemini-embedding-001": 3072,
  "text-embedding-004": 768,
};

// Gemini free tier: 100 embed requests per minute per project
// Each batchEmbedContents call counts as 1 request per text in the batch.
// To stay within the free tier: send batches of 50 with a 35s delay between batches.
// This is conservative — upgrade to paid tier to remove the delay.
const MAX_BATCH_SIZE = 50;
const BATCH_DELAY_MS = 35_000; // 35s between batches (~80 req/min, safely under 100)

const GEMINI_EMBED_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";

export class Embeddings {
  private apiKey: string;
  private model: string;
  public readonly provider: EmbeddingsProvider;
  public readonly dimensions: number;

  constructor(options: EmbeddingsOptions | string, model = DEFAULT_GEMINI_MODEL) {
    const resolved =
      typeof options === "string"
        ? {
            provider: "gemini" as const,
            apiKey: options,
            model,
          }
        : resolveEmbeddingProvider(options);

    if (!resolved.apiKey) {
      throw new Error(
        resolved.provider === "openai"
          ? "OPENAI_API_KEY is required for OpenAI embeddings"
          : "GEMINI_API_KEY is required for Gemini embeddings"
      );
    }

    const dims = EMBEDDING_DIMENSIONS[resolved.model];
    if (!dims) {
      throw new Error(`Unsupported embedding model: ${resolved.model}`);
    }

    this.provider = resolved.provider;
    this.apiKey = resolved.apiKey;
    this.model = resolved.model;
    this.dimensions = dims;
  }

  static fromEnv(): Embeddings {
    const configuredProvider = process.env.EMBEDDINGS_PROVIDER;
    const provider =
      configuredProvider === "openai" || configuredProvider === "gemini"
        ? configuredProvider
        : "auto";

    return new Embeddings({
      provider,
      openaiApiKey: process.env.OPENAI_API_KEY,
      geminiApiKey: process.env.GEMINI_API_KEY,
    });
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<number[]> {
    if (this.provider === "openai") {
      const [embedding] = await this.embedOpenAI([text]);
      return embedding;
    }

    const url = `${GEMINI_EMBED_BASE}/${this.model}:embedContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini embed failed (${response.status}): ${err}`);
    }
    const data = (await response.json()) as {
      embedding: { values: number[] };
    };
    return data.embedding.values;
  }

  /**
   * Generate embeddings for multiple texts in batches.
   * Returns embeddings in the same order as input texts.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    if (this.provider === "openai") {
      return this.embedOpenAI(texts);
    }

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      // Rate-limit: wait between batches to respect Gemini free tier quota
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }

      const batch = texts.slice(i, i + MAX_BATCH_SIZE);

      // Gemini batchEmbedContents endpoint
      const url = `${GEMINI_EMBED_BASE}/${this.model}:batchEmbedContents?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
          })),
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(
          `Gemini batchEmbed failed (${response.status}): ${err}`
        );
      }

      const data = (await response.json()) as {
        embeddings: Array<{ values: number[] }>;
      };
      results.push(...data.embeddings.map((e) => e.values));
    }

    return results;
  }

  private async embedOpenAI(texts: string[]): Promise<number[][]> {
    const response = await fetch(OPENAI_EMBED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embed failed (${response.status}): ${err}`);
    }

    const data = (await response.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };

    return data.data
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.embedding);
  }
}

function resolveEmbeddingProvider(options: EmbeddingsOptions): {
  provider: EmbeddingsProvider;
  apiKey?: string;
  model: string;
} {
  if (options.provider === "openai") {
    return {
      provider: "openai",
      apiKey: options.openaiApiKey,
      model: options.openaiModel ?? DEFAULT_OPENAI_MODEL,
    };
  }

  if (options.provider === "gemini") {
    return {
      provider: "gemini",
      apiKey: options.geminiApiKey,
      model: options.geminiModel ?? DEFAULT_GEMINI_MODEL,
    };
  }

  if (options.openaiApiKey) {
    return {
      provider: "openai",
      apiKey: options.openaiApiKey,
      model: options.openaiModel ?? DEFAULT_OPENAI_MODEL,
    };
  }

  if (options.geminiApiKey) {
    return {
      provider: "gemini",
      apiKey: options.geminiApiKey,
      model: options.geminiModel ?? DEFAULT_GEMINI_MODEL,
    };
  }

  throw new Error("OPENAI_API_KEY or GEMINI_API_KEY is required for embeddings");
}
