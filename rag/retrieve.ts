import { Embeddings } from "./embeddings";
import { DocsStore } from "./store-upstash";
import { Retriever } from "./retriever-upstash";
import { classifyQuery, type ClassifiedQuery } from "./classifier";
import { BM25Searcher, loadTermIndex } from "./bm25-searcher";
import { reciprocalRankFusion, type FusedResult } from "./fusion";
import { getReranker, type RerankResult } from "./reranker";

export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.3;

export const USER_RETRIEVAL_STRATEGIES = [
  "auto",
  "hybrid",
  "semantic",
  "keyword",
] as const;

export type UserRetrievalStrategy = (typeof USER_RETRIEVAL_STRATEGIES)[number];

export interface SalemRetrievalResult {
  id: string;
  content: string;
  title: string;
  url: string;
  score: number;
}

export interface SalemRetrievalOutcome {
  classified: ClassifiedQuery;
  results: SalemRetrievalResult[];
  bestScore: number;
  isLowConfidence: boolean;
  relevanceRank: number;
  retrievalMs: number;
  rerankMs: number;
  context: string;
}

export interface SalemRetrievalOptions {
  query: string;
  userStrategy?: UserRetrievalStrategy;
  confidenceThreshold?: number;
  enableHybrid?: boolean;
  canAccessPrivate?: boolean;
}

/**
 * Shared Salem retrieval pipeline. This function intentionally performs only
 * retrieval/ranking/context shaping. Callers remain responsible for answer
 * policy, authentication, prompting, generation, and response transport.
 */
export async function retrieveSalemEvidence({
  query,
  userStrategy = "auto",
  confidenceThreshold = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  enableHybrid = process.env.ENABLE_HYBRID_SEARCH === "true",
  canAccessPrivate = false,
}: SalemRetrievalOptions): Promise<SalemRetrievalOutcome> {
  const classified = classifyQuery(query);

  if (userStrategy !== "auto") {
    classified.strategy = userStrategy;
  }

  const embeddings = Embeddings.fromEnv();
  const store = new DocsStore();
  const retriever = new Retriever(store, embeddings);

  let finalResults: SalemRetrievalResult[] = [];
  let retrievalMs = 0;
  let rerankMs = 0;
  const retrievalStart = Date.now();

  if (enableHybrid) {
    const termIndex = await loadTermIndex();
    const bm25Searcher = termIndex ? new BM25Searcher(termIndex) : null;

    let semanticResults: Awaited<ReturnType<typeof retriever.retrieve>> = [];
    let keywordResults: Array<{ id: string; score: number }> = [];

    if (classified.strategy !== "keyword") {
      semanticResults = await retriever.retrieve(classified.expanded, 20);
    }

    if (bm25Searcher && classified.strategy !== "semantic") {
      const keywordQuery = classified.keywords.join(" ");
      keywordResults = bm25Searcher.search(keywordQuery, 20);
    }

    // Preserve the historical chat metric boundary: retrievalMs is captured
    // before fusion and before the keyword-only semantic hydration fallback.
    retrievalMs = Date.now() - retrievalStart;

    const chunkMap = new Map(
      semanticResults.map((result) => [result.chunk.id, result.chunk]),
    );

    let fusedResults: FusedResult[];

    if (
      classified.strategy === "hybrid" &&
      keywordResults.length > 0 &&
      semanticResults.length > 0
    ) {
      fusedResults = reciprocalRankFusion(
        semanticResults,
        keywordResults,
        chunkMap,
      );
    } else if (classified.strategy === "keyword" && keywordResults.length > 0) {
      if (semanticResults.length > 0) {
        const keywordIds = new Set(keywordResults.map((result) => result.id));
        const matchingResults = semanticResults.filter((result) =>
          keywordIds.has(result.chunk.id),
        );

        fusedResults = matchingResults.map((result, index) => ({
          id: result.chunk.id,
          chunk: result.chunk,
          semanticRank: null,
          semanticScore: null,
          keywordRank: index + 1,
          keywordScore:
            keywordResults.find((item) => item.id === result.chunk.id)?.score || 0,
          fusedScore:
            keywordResults.find((item) => item.id === result.chunk.id)?.score || 0,
        }));
      } else {
        const semanticFallback = await retriever.retrieve(classified.expanded, 20);
        semanticFallback.forEach((result) =>
          chunkMap.set(result.chunk.id, result.chunk),
        );
        fusedResults = reciprocalRankFusion(
          semanticFallback,
          keywordResults,
          chunkMap,
        );
      }
    } else {
      fusedResults = semanticResults.map((result, index) => ({
        id: result.chunk.id,
        chunk: result.chunk,
        semanticRank: index + 1,
        semanticScore: result.score,
        keywordRank: null,
        keywordScore: null,
        fusedScore: result.score,
      }));
    }

    const rerankStart = Date.now();
    const reranker = getReranker();
    const docsToRerank = fusedResults.slice(0, 25).map((result) => ({
      id: result.id,
      content: result.chunk.content,
      title: result.chunk.title,
      url: result.chunk.url,
    }));

    const reranked: RerankResult[] = await reranker.rerank(
      classified.original,
      docsToRerank,
      8,
    );

    rerankMs = Date.now() - rerankStart;

    finalResults = reranked.map((result) => {
      const original = docsToRerank.find((doc) => doc.id === result.id)!;
      return {
        id: result.id,
        content: original.content,
        title: original.title,
        url: original.url,
        score: result.relevanceScore,
      };
    });
  } else {
    const results = await retriever.retrieve(query, 8);
    retrievalMs = Date.now() - retrievalStart;

    finalResults = results.map((result) => ({
      id: result.chunk.id,
      content: result.chunk.content,
      title: result.chunk.title,
      url: result.chunk.url,
      score: result.score,
    }));
  }

  finalResults = filterPrivateRetrievalResults(finalResults, canAccessPrivate);

  const hasResults = finalResults.length > 0;
  const bestScore = hasResults ? finalResults[0].score : 0;
  const isLowConfidence = !hasResults || bestScore < confidenceThreshold;
  const relevanceRank = computeRelevanceRank(
    bestScore,
    finalResults.length,
    classified.intent,
    isLowConfidence,
  );

  return {
    classified,
    results: finalResults,
    bestScore,
    isLowConfidence,
    relevanceRank,
    retrievalMs,
    rerankMs,
    context: buildRetrievalContext(finalResults),
  };
}

export function filterPrivateRetrievalResults<T extends { url: string }>(
  results: T[],
  canAccessPrivate: boolean,
): T[] {
  if (canAccessPrivate) return results;
  return results.filter((result) => !result.url.startsWith("private://"));
}

export function buildRetrievalContext(
  results: SalemRetrievalResult[],
): string {
  if (results.length === 0) return "";
  return results
    .map(
      (result) =>
        `[${result.title}](${result.url})\n${result.content.slice(0, 1200)}`,
    )
    .join("\n\n---\n\n");
}

export function computeRelevanceRank(
  bestScore: number,
  resultCount: number,
  intent: string,
  isLowConfidence: boolean,
): number {
  let rank = 0;

  if (bestScore >= 0.75) rank += 2;
  else if (bestScore >= 0.45) rank += 1.5;
  else if (bestScore >= 0.25) rank += 1;
  else if (bestScore >= 0.1) rank += 0.5;

  if (resultCount >= 5) rank += 1;
  else if (resultCount >= 2) rank += 0.5;

  if (intent === "lookup" || intent === "troubleshooting") rank += 1;
  else if (intent === "conceptual") rank += 0.5;

  if (!isLowConfidence) rank += 1;

  return Math.max(1, Math.min(5, Math.round(rank)));
}
