/**
 * Normalizes Persian and Arabic text for consistent searching.
 */
export function normalizeSearchQuery(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .trim()
    .replace(/[يى]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/[إأآا]/g, "ا")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ") // Zero-width spaces
    .replace(/\s+/g, " ");
}

/**
 * Calculates a search relevance score between 0 and 100 for a target text against a query.
 */
export function calculateRelevance(target: string | null | undefined, query: string): number {
  if (!target || !query) return 0;
  const normTarget = normalizeSearchQuery(target);
  const normQuery = normalizeSearchQuery(query);

  if (!normTarget || !normQuery) return 0;

  // Exact match
  if (normTarget === normQuery) return 100;

  // Starts with
  if (normTarget.startsWith(normQuery)) return 85;

  // Words start with query
  const words = normTarget.split(" ");
  if (words.some((w) => w.startsWith(normQuery))) return 70;

  // Contains query
  if (normTarget.includes(normQuery)) return 50;

  // Substring match for query tokens
  const queryTokens = normQuery.split(" ").filter(Boolean);
  let matchedTokens = 0;
  for (const token of queryTokens) {
    if (normTarget.includes(token)) {
      matchedTokens++;
    }
  }

  if (queryTokens.length > 0 && matchedTokens > 0) {
    return Math.floor((matchedTokens / queryTokens.length) * 40);
  }

  return 0;
}
