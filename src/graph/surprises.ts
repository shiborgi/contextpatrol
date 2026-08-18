import { compareBytewise } from "../hash.js";
import type { FileFact } from "../model.js";
import type { CodeGraph } from "./code-graph.js";
import type { Community } from "./communities.js";

export interface Surprise {
  from: string;
  to: string;
  score: number;
  reasons: string[];
}

const MAX_SURPRISES = 10;
const HUB_COUNT = 5;

function stripPrefix(id: string): string {
  return id.startsWith("sym:") ? id.slice(4) : id;
}

export function detectSurprises(
  graph: CodeGraph,
  communities: Community[],
  godSymbols: Array<{ qualifiedName: string; score: number }>,
  fileFacts: FileFact[],
): Surprise[] {
  if (communities.length === 0) {
    return [];
  }

  // symbol qualified name -> community id
  const communityOf = new Map<string, string>();
  for (const c of communities) {
    for (const member of c.members) {
      communityOf.set(member, c.id);
    }
  }

  // symbol qualified name -> language
  const languageOf = new Map<string, string>();
  for (const file of fileFacts) {
    for (const sym of file.symbols) {
      languageOf.set(sym.qualifiedName, file.language);
    }
  }

  // hubs = top-N god symbols by score
  const hubs = new Set(
    [...godSymbols]
      .sort(
        (a, b) =>
          b.score - a.score || compareBytewise(a.qualifiedName, b.qualifiedName),
      )
      .slice(0, HUB_COUNT)
      .map((g) => g.qualifiedName),
  );

  const surprises: Surprise[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== "CALLS") continue;
    if (!edge.from.startsWith("sym:") || !edge.to.startsWith("sym:")) continue;

    const from = stripPrefix(edge.from);
    const to = stripPrefix(edge.to);
    if (from === to) continue;

    const reasons: string[] = [];
    let score = 0;

    const fromCommunity = communityOf.get(from);
    const toCommunity = communityOf.get(to);
    if (
      fromCommunity !== undefined &&
      toCommunity !== undefined &&
      fromCommunity !== toCommunity
    ) {
      score += 3;
      reasons.push("cross-community");
    }

    const fromLang = languageOf.get(from);
    const toLang = languageOf.get(to);
    if (fromLang !== undefined && toLang !== undefined && fromLang !== toLang) {
      score += 2;
      reasons.push("cross-language");
    }

    const fromHub = hubs.has(from);
    const toHub = hubs.has(to);
    if (fromHub !== toHub) {
      score += 2;
      reasons.push("hub-periphery");
    }

    if (score > 0) {
      surprises.push({ from, to, score, reasons });
    }
  }

  return surprises
    .sort(
      (a, b) =>
        b.score - a.score ||
        compareBytewise(`${a.from}\0${a.to}`, `${b.from}\0${b.to}`),
    )
    .slice(0, MAX_SURPRISES);
}
