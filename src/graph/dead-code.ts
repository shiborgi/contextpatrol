import { compareBytewise } from "../hash.js";
import type { FileFact } from "../model.js";
import type { CodeGraph } from "./code-graph.js";

export interface DeadCodeEntry {
  qualifiedName: string;
  confidence: number;
}

const ENTRY_RE = /(?:^|\/)index\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;

function isEntryPath(path: string): boolean {
  if (path.startsWith("bin/")) return true;
  return ENTRY_RE.test(path);
}

/**
 * Dead code is an inferred claim (not extracted): exported symbols with no
 * incoming CALLS edge, excluding entry-point and test symbols. The entire
 * claim is suppressed when the graph has zero CALLS edges, honoring the
 * zero-edge guarantee (absence of evidence is not evidence of absence).
 */
export function detectDeadCode(
  graph: CodeGraph,
  fileFacts: FileFact[],
): DeadCodeEntry[] {
  const hasCalls = graph.edges.some((e) => e.kind === "CALLS");
  if (!hasCalls) {
    return [];
  }

  const called = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "CALLS" && edge.to.startsWith("sym:")) {
      called.add(edge.to);
    }
  }

  // Type-level declarations can never receive a CALLS edge; reporting them as
  // dead would be a false positive.
  const TYPE_ONLY_KINDS = new Set(["interface", "type", "enum"]);

  const result: DeadCodeEntry[] = [];
  for (const file of fileFacts) {
    for (const sym of file.symbols) {
      if (!sym.exported) continue;
      if (sym.isTest) continue;
      if (TYPE_ONLY_KINDS.has(sym.kind)) continue;
      if (isEntryPath(sym.path)) continue;
      if (called.has(`sym:${sym.qualifiedName}`)) continue;
      result.push({ qualifiedName: sym.qualifiedName, confidence: 0.6 });
    }
  }

  return result
    .sort((a, b) => compareBytewise(a.qualifiedName, b.qualifiedName))
    .slice(0, 50);
}
