import type { CodeGraph } from "./../graph/code-graph.js";
import { compareBytewise } from "../hash.js";

export interface DirImport {
  from: string;
  to: string;
  count: number;
}

const CAP = 50;

function topDirOf(path: string): string {
  const dir = path.split("/")[0] ?? ".";
  return dir === "" ? "." : dir;
}

// WORK-7.4.1: inter-directory IMPORTS matrix. Counts IMPORTS edges whose from
// and to are in different top-level directories; omitted here and decided
// upstream. Deterministic: sorted count desc, then bytewise from and to.
export function computeDirImports(graph: CodeGraph): DirImport[] {
  const counts = new Map<string, DirImport>();
  for (const edge of graph.edges) {
    if (
      edge.kind !== "IMPORTS" ||
      !edge.from.startsWith("file:") ||
      !edge.to.startsWith("file:")
    ) {
      continue;
    }
    const fromDir = topDirOf(edge.from.slice(5));
    const toDir = topDirOf(edge.to.slice(5));
    if (fromDir === toDir) {
      continue;
    }
    const key = `${fromDir}\u0000${toDir}`;
    const entry = counts.get(key) ?? { from: fromDir, to: toDir, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }

  return [...counts.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        compareBytewise(a.from, b.from) ||
        compareBytewise(a.to, b.to),
    )
    .slice(0, CAP);
}
