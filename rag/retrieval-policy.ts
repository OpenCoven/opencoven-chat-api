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

export function buildRetrievalContext(
  results: Array<{ title: string; url: string; content: string }>,
): string {
  if (results.length === 0) return "";

  return results
    .map(
      (result) =>
        `[${result.title}](${result.url})\n${result.content.slice(0, 1200)}`,
    )
    .join("\n\n---\n\n");
}
