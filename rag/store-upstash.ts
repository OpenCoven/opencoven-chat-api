/**
 * Upstash Vector storage layer for docs-chat RAG pipeline.
 * Stores document chunks with vector embeddings for semantic search.
 * Replaces LanceDB for serverless deployment compatibility.
 */
import { Index } from "@upstash/vector";

/**
 * Whether a chunk may be served to a caller without private-source access.
 * Derived at index time from the source URL and stored on the vector so the
 * store itself can enforce the boundary, rather than relying on every caller
 * to filter results afterwards.
 */
export type ChunkVisibility = "public" | "private";

export const PRIVATE_URL_PREFIX = "private://";

export function visibilityForUrl(url: string): ChunkVisibility {
  return url.startsWith(PRIVATE_URL_PREFIX) ? "private" : "public";
}

export interface DocsChunk {
  id: string;
  path: string;
  title: string;
  content: string;
  url: string;
  visibility: ChunkVisibility;
  vector: number[];
}

export interface SearchResult {
  chunk: DocsChunk;
  distance: number;
  similarity: number;
}

interface ChunkMetadata {
  path: string;
  title: string;
  content: string;
  url: string;
  visibility: ChunkVisibility;
  [key: string]: unknown; // Index signature for Upstash Dict compatibility
}

// Upstash Vector has a limit of 1000 vectors per upsert batch
const UPSERT_BATCH_SIZE = 1000;

export class DocsStore {
  private index: Index<ChunkMetadata>;

  constructor() {
    const url = process.env.UPSTASH_VECTOR_REST_URL;
    const token = process.env.UPSTASH_VECTOR_REST_TOKEN;

    if (!url || !token) {
      throw new Error(
        "UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN are required",
      );
    }

    this.index = new Index<ChunkMetadata>({ url, token });
  }

  /**
   * Drop existing vectors and upsert new chunks.
   * Used during index rebuild.
   */
  async replaceAll(chunks: DocsChunk[]): Promise<void> {
    // Reset the index (delete all vectors)
    await this.index.reset();

    if (chunks.length === 0) {
      return;
    }

    // Upsert in batches to respect API limits
    for (let i = 0; i < chunks.length; i += UPSERT_BATCH_SIZE) {
      const batch = chunks.slice(i, i + UPSERT_BATCH_SIZE);
      const vectors = batch.map((chunk) => ({
        id: chunk.id,
        vector: chunk.vector,
        metadata: {
          path: chunk.path,
          title: chunk.title,
          content: chunk.content,
          url: chunk.url,
          // Recomputed here rather than trusted from the caller so a chunk can
          // never be upserted as public with a private:// URL.
          visibility: visibilityForUrl(chunk.url),
        },
      }));

      await this.index.upsert(vectors);
      console.error(
        `Upserted batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}/${Math.ceil(chunks.length / UPSERT_BATCH_SIZE)}`,
      );
    }
  }

  /**
   * Search for similar chunks using vector similarity.
   *
   * `includePrivate` defaults to false so that forgetting to pass it fails
   * closed. Private chunks are excluded by the store itself via a metadata
   * filter, so they are never returned to an unprivileged caller in the first
   * place; the caller-side URL filter in app/api/chat/auth.ts remains as a
   * second, independent layer.
   */
  async search(
    vector: number[],
    limit: number = 8,
    includePrivate: boolean = false,
  ): Promise<SearchResult[]> {
    const results = await this.index.query<ChunkMetadata>({
      vector,
      topK: limit,
      includeMetadata: true,
      includeVectors: false,
      ...(includePrivate ? {} : { filter: "visibility = 'public'" }),
    });

    return results.map((result) => {
      // Upstash returns cosine similarity score (0-1, higher is more similar)
      const similarity = result.score;
      // Convert to distance for compatibility with existing code
      const distance = 1 - similarity;

      const metadata = result.metadata!;
      return {
        chunk: {
          id: result.id as string,
          path: metadata.path,
          title: metadata.title,
          content: metadata.content,
          url: metadata.url,
          visibility: metadata.visibility ?? visibilityForUrl(metadata.url),
          vector: [], // Don't return vector to save memory
        },
        distance,
        similarity,
      };
    });
  }

  /**
   * Get count of stored chunks.
   */
  async count(): Promise<number> {
    const info = await this.index.info();
    return info.vectorCount;
  }
}
