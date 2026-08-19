import { compareBytewise } from "../hash.js";
import type { CodeGraph } from "./code-graph.js";

export interface CentralityResult {
  godSymbols: Array<{ qualifiedName: string; score: number }>;
  boundaryFiles: string[];
}

const DEFAULT_NOISE = new Set([
  "constructor",
  "toString",
  "console",
  "process",
  "require",
  "module",
  "exports",
]);

function filePathOf(qname: string): string {
  return qname.includes("#") ? (qname.split("#")[0] ?? qname) : qname;
}

export function computeCentrality(
  graph: CodeGraph,
  exportedNames: ReadonlySet<string> = new Set(),
): CentralityResult {
  const inDegree = new Map<string, number>();
  const crossFileCalled = new Set<string>();

  // Count in-degree for symbol nodes via CALLS edges
  for (const edge of graph.edges) {
    if (edge.kind === "CALLS" && edge.to.startsWith("sym:")) {
      const qname = edge.to.slice(4); // strip "sym:"
      const name = qname.includes("#")
        ? (qname.split("#")[1]?.split(".").pop() ?? qname)
        : qname;
      if (DEFAULT_NOISE.has(name)) {
        continue;
      }
      if (
        edge.from.startsWith("sym:") &&
        filePathOf(edge.from.slice(4)) !== filePathOf(qname)
      ) {
        crossFileCalled.add(qname);
      }
      inDegree.set(qname, (inDegree.get(qname) ?? 0) + 1);
    }
  }

  // A god-symbol must be an exported symbol or one called from another file;
  // a same-file helper with high in-degree is noise, not a hub.
  const godSymbols = [...inDegree.entries()]
    .filter(
      ([qualifiedName]) =>
        exportedNames.has(qualifiedName) || crossFileCalled.has(qualifiedName),
    )
    .map(([qualifiedName, score]) => ({ qualifiedName, score }))
    .sort(
      (a, b) => b.score - a.score || compareBytewise(a.qualifiedName, b.qualifiedName),
    );

  // Boundary files
  const boundaryFilesSet = new Set<string>();
  const topDirOf = (path: string): string => {
    return path.includes("/") ? (path.split("/")[0] ?? ".") : ".";
  };

  for (const edge of graph.edges) {
    if (
      edge.kind === "IMPORTS" &&
      edge.from.startsWith("file:") &&
      edge.to.startsWith("file:")
    ) {
      const fromPath = edge.from.slice(5);
      const toPath = edge.to.slice(5);
      const fromDir = topDirOf(fromPath);
      const toDir = topDirOf(toPath);
      if (fromDir !== toDir) {
        boundaryFilesSet.add(toPath);
      }
    }
  }

  const boundaryFiles = [...boundaryFilesSet].sort(compareBytewise);

  return { godSymbols, boundaryFiles };
}
