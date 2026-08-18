import { computeCentrality } from "../graph/centrality.js";
import { buildCodeGraph, type CodeGraph } from "../graph/code-graph.js";
import { type Community, detectCommunities } from "../graph/communities.js";
import { type DeadCodeEntry, detectDeadCode } from "../graph/dead-code.js";
import { mineHistory } from "../history/git-history.js";
import type { ScanResult } from "../snapshot.js";
import { mapDiff } from "./diff-map.js";

export const HISTORY_WINDOW = 2000;

export interface Analysis {
  graph: CodeGraph;
  godSymbols: Array<{ qualifiedName: string; score: number }>;
  boundaryFiles: string[];
  changedSymbols: Set<string>;
  churn: Map<string, number>;
  maxChurn: number;
  maxInDegree: number;
  historyWindow: number;
  communities: Community[];
  deadCode: DeadCodeEntry[];
}

export function analyze(
  scan: ScanResult,
  root: string,
  denylist: readonly string[],
  changedPaths: string[],
): Analysis {
  const graph = buildCodeGraph(scan.fileFacts, scan.eligiblePaths);
  const { godSymbols, boundaryFiles } = computeCentrality(graph);
  const changedSymbols = mapDiff(root, scan.fileFacts, denylist, changedPaths);
  const history = mineHistory(root, denylist, HISTORY_WINDOW);
  const communities = detectCommunities(graph);
  const deadCode = detectDeadCode(graph, scan.fileFacts);

  const churn = new Map(history.churn.map((c) => [c.path, c.count]));
  const maxChurn = history.churn.reduce((m, c) => Math.max(m, c.count), 0);
  const maxInDegree = godSymbols.reduce((m, g) => Math.max(m, g.score), 0);

  return {
    graph,
    godSymbols,
    boundaryFiles,
    changedSymbols,
    churn,
    maxChurn,
    maxInDegree,
    historyWindow: HISTORY_WINDOW,
    communities,
    deadCode,
  };
}
