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

/**
 * The store-side predicate that keeps private chunks out of a search.
 *
 * Deliberately keyed on `url`, not on the `visibility` metadata: vectors
 * written before `visibility` existed do not carry that field, and an equality
 * filter on a missing field matches nothing -- which would return zero results
 * for every query until a full reindex completed.
 */
export function publicOnlyFilter(): string {
  return `url NOT GLOB '${PRIVATE_URL_PREFIX}*'`;
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
   * Replace the index contents with `chunks`, without an empty window.
   *
   * This previously called index.reset() first, which left the index empty from
   * the start of the rebuild until the final batch landed -- roughly 44s in
   * production. Live chat during that window retrieved nothing and silently
   * fell back to the general-knowledge prompt.
   *
   * Chunk IDs are deterministic (sha256 of url:index), so instead we upsert the
   * new set first -- unchanged chunks overwrite themselves in place -- and only
   * then delete the IDs that are no longer present. Readers always see either
   * the old or the new content, never nothing. A crash mid-rebuild leaves stale
   * extra chunks rather than an empty index, which the next run cleans up.
   */
  async replaceAll(chunks: DocsChunk[]): Promise<void> {
    if (chunks.length === 0) {
      // An empty build is treated as a failure upstream; refuse to wipe a good
      // index on the strength of it.
      throw new Error("Refusing to replace the index with zero chunks");
    }

    const previousIds = await this.listAllIds();

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

    const currentIds = new Set(chunks.map((chunk) => chunk.id));
    const staleIds = previousIds.filter((id) => !currentIds.has(id));

    for (let i = 0; i < staleIds.length; i += UPSERT_BATCH_SIZE) {
      await this.index.delete(staleIds.slice(i, i + UPSERT_BATCH_SIZE));
    }

    if (staleIds.length > 0) {
      console.error(`Removed ${staleIds.length} chunk(s) no longer present in the sources`);
    }
  }

  /**
   * Enumerates every vector ID currently in the index, so a rebuild can work
   * out which chunks disappeared from the sources.
   */
  private async listAllIds(): Promise<string[]> {
    const ids: string[] = [];
    let cursor = "0";

    do {
      const page = await this.index.range({
        cursor,
        limit: UPSERT_BATCH_SIZE,
        includeMetadata: false,
        includeVectors: false,
      });
      ids.push(...page.vectors.map((vector) => String(vector.id)));
      cursor = page.nextCursor;
    } while (cursor && cursor !== "0");

    return ids;
  }

  /**
   * Search for similar chunks using vector similarity.
   *
   * `includePrivate` defaults to false so that forgetting to pass it fails
   * closed. Private chunks are excluded by the store itself, so they are never
   * returned to an unprivileged caller in the first place; the caller-side URL
   * filter in app/api/chat/auth.ts remains as a second, independent layer.
   *
   * The filter matches on `url` rather than the `visibility` metadata added
   * alongside it. Every vector has always carried a url, so this also excludes
   * private chunks written before `visibility` existed -- filtering on
   * `visibility = 'public'` would silently match nothing until a full reindex
   * and drop the index to zero results. It is also the exact predicate used by
   * isPrivateSourceUrl(), so the two layers cannot drift apart.
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
      ...(includePrivate ? {} : { filter: publicOnlyFilter() }),
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
