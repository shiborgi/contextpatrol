import { compareText } from "./json.js";
import type { CachedFacts, RankingHints, SourceFile } from "./types.js";

export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [])].sort(
    compareText,
  );
}

export function score(
  file: SourceFile,
  facts: CachedFacts,
  terms: string[],
  changed = false,
  ranking?: RankingHints,
): number {
  const activeTerms =
    ranking?.boostIdents && ranking.boostIdents.length > 0
      ? [...new Set([...terms, ...queryTerms(ranking.boostIdents.join(" "))])].sort(
          compareText,
        )
      : terms;
  const pathTerms = file.path.toLowerCase();
  const contentTerms = queryTerms(file.content);
  let relevance = activeTerms.reduce((total, term) => {
    const symbolHits = facts.terms.filter((value) => value === term).length;
    const contentHits = contentTerms.filter((value) => value === term).length;
    return total + symbolHits * 4 + (pathTerms.includes(term) ? 2 : 0) + contentHits;
  }, 0);
  if (ranking) {
    let multiplier = 1;
    for (const entry of ranking.boostPaths ?? [])
      if (pathTerms.startsWith(entry.toLowerCase())) multiplier *= 10;
    for (const entry of ranking.dampenPaths ?? [])
      if (pathTerms.startsWith(entry.toLowerCase())) multiplier *= 0.1;
    relevance *= multiplier;
  }
  return relevance + (changed ? 1_000_000 : 0);
}
