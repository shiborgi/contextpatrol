import { compareText } from "./json.js";
import type { CachedFacts, SourceFile } from "./types.js";

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
): number {
  const pathTerms = file.path.toLowerCase();
  const relevance = terms.reduce((total, term) => {
    const symbolHits = facts.terms.filter((value) => value === term).length;
    return total + symbolHits * 4 + (pathTerms.includes(term) ? 2 : 0);
  }, 0);
  return relevance + (changed ? 1_000_000 : 0);
}
