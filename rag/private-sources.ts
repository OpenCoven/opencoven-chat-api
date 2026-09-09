export function isPrivateSourceUrl(url: string): boolean {
  return url.startsWith("private://");
}

export function filterPrivateSourceResults<T extends { url: string }>(
  results: T[],
  canAccessPrivate: boolean,
): T[] {
  if (canAccessPrivate) return results;
  return results.filter((result) => !isPrivateSourceUrl(result.url));
}
