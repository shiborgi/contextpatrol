import type { CodeGraph } from "../graph/code-graph.js";
import type { SymbolFact } from "../model.js";

export interface RiskFactor {
  factor: string;
  raw: number;
  capped: number;
  contribution: number;
}

export interface SymbolRisk {
  qualifiedName: string;
  totalRisk: number;
  factors: RiskFactor[];
}

const SECURITY_KEYWORDS = [
  "auth",
  "token",
  "secret",
  "password",
  "crypto",
  "credential",
  "session",
  "permission",
];

export function scoreSymbolRisk(
  sym: SymbolFact,
  graph: CodeGraph,
  churnMap: Map<string, number>,
  maxChurn: number,
  maxInDegree: number,
): SymbolRisk {
  const factors: RiskFactor[] = [];
  const topDirOf = (path: string): string => {
    return path.includes("/") ? (path.split("/")[0] ?? ".") : ".";
  };
  const symFileDir = topDirOf(sym.path);

  // 1. Untested (cap 0.30)
  // Check if there is any TESTED_BY edge targeting this symbol's file
  const fileNodeId = `file:${sym.path}`;
  const hasTests = graph.edges.some(
    (e) => e.kind === "TESTED_BY" && e.to === fileNodeId,
  );
  const untestedRaw = hasTests ? 1 : 0;
  const untestedContrib = hasTests ? 0.0 : 0.3;
  factors.push({
    factor: "untested",
    raw: untestedRaw,
    capped: untestedContrib,
    contribution: untestedContrib,
  });

  // 2. Security keyword (cap 0.20)
  const lowerName = sym.name.toLowerCase();
  const isSecurity = SECURITY_KEYWORDS.some((kw) => lowerName.includes(kw));
  const secRaw = isSecurity ? 1 : 0;
  const secContrib = isSecurity ? 0.2 : 0.0;
  factors.push({
    factor: "security-keyword",
    raw: secRaw,
    capped: secContrib,
    contribution: secContrib,
  });

  // 3. Churn (cap 0.15)
  const fileChurn = churnMap.get(sym.path) ?? 0;
  const churnContrib =
    maxChurn > 0 ? Math.min(0.15, (fileChurn / maxChurn) * 0.15) : 0.0;
  factors.push({
    factor: "churn",
    raw: fileChurn,
    capped: churnContrib,
    contribution: churnContrib,
  });

  // 4. Cross-boundary callers (cap 0.15)
  // Check if any CALLS edge to this symbol is from a file in a different top-level dir group
  const symNodeId = `sym:${sym.qualifiedName}`;
  const hasCrossBoundary = graph.edges.some((e) => {
    if (e.kind === "CALLS" && e.to === symNodeId) {
      if (e.from.startsWith("sym:")) {
        const callerQName = e.from.slice(4);
        const callerFile = callerQName.split("#")[0] ?? "";
        return topDirOf(callerFile) !== symFileDir;
      }
      if (e.from.startsWith("file:")) {
        const callerFile = e.from.slice(5);
        return topDirOf(callerFile) !== symFileDir;
      }
    }
    return false;
  });
  const cbRaw = hasCrossBoundary ? 1 : 0;
  const cbContrib = hasCrossBoundary ? 0.15 : 0.0;
  factors.push({
    factor: "cross-boundary-callers",
    raw: cbRaw,
    capped: cbContrib,
    contribution: cbContrib,
  });

  // 5. Fan-in (cap 0.10)
  const inDegree = graph.edges.filter(
    (e) => e.kind === "CALLS" && e.to === symNodeId,
  ).length;
  const fiContrib =
    maxInDegree > 0 ? Math.min(0.1, (inDegree / maxInDegree) * 0.1) : 0.0;
  factors.push({
    factor: "fan-in",
    raw: inDegree,
    capped: fiContrib,
    contribution: fiContrib,
  });

  const sum = factors.reduce((acc, f) => acc + f.contribution, 0);
  const totalRisk = parseFloat(Math.min(1.0, sum).toFixed(4));

  return {
    qualifiedName: sym.qualifiedName,
    totalRisk,
    factors,
  };
}
