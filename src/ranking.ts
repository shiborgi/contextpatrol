import type { CodeGraph } from "./graph/code-graph.js";
import { compareBytewise } from "./hash.js";
import type { SymbolFact } from "./model.js";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "be",
  "it",
  "this",
  "that",
  "which",
  "as",
  "at",
  "by",
  "from",
  "into",
  "about",
  "over",
  "under",
  "do",
  "does",
  "did",
]);

export function tokenizeAndExtract(text: string): {
  terms: string[];
  identifiers: string[];
} {
  const terms: string[] = [];
  const identifiers: string[] = [];

  // Extract identifier shapes: PascalCase, snake_case, dotted.path
  const idRegex =
    /\b(?:[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+|[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[a-z0-9]+(?:_[a-z0-9]+)+)\b/g;
  const matches = text.match(idRegex) ?? [];
  for (const m of matches) {
    if (!identifiers.includes(m)) {
      identifiers.push(m);
    }
  }

  // General tokenization (split by non-alphanumeric, camel/snake split)
  const rawWords = text.split(/[^a-zA-Z0-9]+/);
  for (const word of rawWords) {
    if (word.length < 2) continue;

    // Camel split: split on transition from lowercase to uppercase
    const camelParts = word.split(/(?=[A-Z][a-z])/);
    for (const part of camelParts) {
      const p = part.toLowerCase();
      if (p.length >= 2 && !STOPWORDS.has(p) && !terms.includes(p)) {
        terms.push(p);
      }
    }
  }

  return { terms, identifiers };
}

export function rankSymbols(
  allSymbols: SymbolFact[],
  intent: string,
  graph: CodeGraph,
  changedSymbols: Set<string>,
  godSymbols: Array<{ qualifiedName: string; score: number }>,
): SymbolFact[] {
  const { terms, identifiers } = tokenizeAndExtract(intent);

  // 1. Text Match List
  const textScores = new Map<string, number>();
  for (const sym of allSymbols) {
    let score = 0;
    const nameLower = sym.name.toLowerCase();
    const qnameLower = sym.qualifiedName.toLowerCase();
    const pathLower = sym.path.toLowerCase();
    const contextLower = `${sym.signature} ${sym.jsdoc}`.toLowerCase();

    for (const term of terms) {
      if (nameLower.includes(term)) score += 3;
      if (qnameLower.includes(term)) score += 2;
      if (pathLower.includes(term)) score += 2;
      if (contextLower.includes(term)) score += 1;
    }
    if (sym.exported) {
      score += 1;
    }

    // Boost if matches any identifier-shaped token (case-insensitive)
    for (const id of identifiers) {
      const idLower = id.toLowerCase();
      if (
        sym.name.toLowerCase() === idLower ||
        sym.qualifiedName.toLowerCase().endsWith(idLower)
      ) {
        score += 15;
      }
    }
    textScores.set(sym.qualifiedName, score);
  }

  const textRanked = [...allSymbols]
    .sort((a, b) => {
      const sa = textScores.get(a.qualifiedName) ?? 0;
      const sb = textScores.get(b.qualifiedName) ?? 0;
      return sb - sa || compareBytewise(a.qualifiedName, b.qualifiedName);
    })
    .map((s) => s.qualifiedName);

  // 2. God Symbols List (centrality)
  const godRanked = godSymbols.map((g) => g.qualifiedName);

  // 3. Changed Symbols List (diff-map)
  const changedRanked = [...changedSymbols].sort(compareBytewise);

  // 4. Import Neighborhood List
  const changedPaths = new Set<string>();
  for (const qs of changedSymbols) {
    changedPaths.add(qs.split("#")[0] ?? "");
  }

  const neighborFiles = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "IMPORTS" && edge.from.startsWith("file:")) {
      const fromPath = edge.from.slice(5);
      if (changedPaths.has(fromPath)) {
        neighborFiles.add(edge.to.slice(5));
      }
    }
  }

  const neighborhoodRanked = allSymbols
    .filter((s) => neighborFiles.has(s.path))
    .map((s) => s.qualifiedName)
    .sort(compareBytewise);

  // RRF Merge
  const rrfScores = new Map<string, number>();

  const addRrfRank = (rankedList: string[]): void => {
    for (let i = 0; i < rankedList.length; i++) {
      const qname = rankedList[i]!;
      const rank = i + 1;
      rrfScores.set(qname, (rrfScores.get(qname) ?? 0) + 1 / (60 + rank));
    }
  };

  addRrfRank(textRanked);
  addRrfRank(godRanked);
  addRrfRank(changedRanked);
  addRrfRank(neighborhoodRanked);

  // Final fused sort
  return [...allSymbols].sort((a, b) => {
    const scoreA = rrfScores.get(a.qualifiedName) ?? 0;
    const scoreB = rrfScores.get(b.qualifiedName) ?? 0;
    return scoreB - scoreA || compareBytewise(a.qualifiedName, b.qualifiedName);
  });
}
