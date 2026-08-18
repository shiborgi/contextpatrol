import { compareBytewise } from "../hash.js";
import type { CodeGraph } from "./code-graph.js";

export interface ImpactEntry {
  id: string;
  score: number;
}

export interface ImpactResult {
  direct: ImpactEntry[];
  transitive: ImpactEntry[];
}

export function computeImpact(graph: CodeGraph, seeds: string[]): ImpactResult {
  const maxScores = new Map<string, number>();
  const depths = new Map<string, number>();

  // Initialize seeds
  const seedSet = new Set(seeds);
  const queue: Array<{ id: string; score: number; depth: number }> = [];
  for (const seed of seeds) {
    maxScores.set(seed, 1.0);
    depths.set(seed, 0);
    queue.push({ id: seed, score: 1.0, depth: 0 });
  }

  // Build reverse adjacency list
  // directed edge A -> B (A calls/imports B) means reverse edge B -> A
  const reverseAdjacency = new Map<string, Array<{ from: string; kind: string }>>();
  for (const edge of graph.edges) {
    const list = reverseAdjacency.get(edge.to) ?? [];
    list.push({ from: edge.from, kind: edge.kind });
    reverseAdjacency.set(edge.to, list);
  }

  const getWeight = (kind: string): number => {
    if (kind === "CALLS") return 1.0;
    if (kind === "IMPORTS") return 0.8;
    return 0.0;
  };

  while (queue.length > 0) {
    // Sort queue by score desc to process highest scores first (best-score relaxation)
    queue.sort((a, b) => b.score - a.score);
    const curr = queue.shift()!;

    // Node cap check: stop expanding if we have already reached 500 nodes (excluding seeds)
    const currentVisitedCount = [...maxScores.keys()].filter(
      (id) => !seedSet.has(id),
    ).length;
    if (currentVisitedCount >= 500 && !maxScores.has(curr.id)) {
      continue;
    }

    if (curr.depth >= 3) {
      continue;
    }

    const neighbors = reverseAdjacency.get(curr.id) ?? [];
    for (const edge of neighbors) {
      const weight = getWeight(edge.kind);
      if (weight === 0.0) {
        continue;
      }
      const nextScore = curr.score * 0.5 * weight;
      if (nextScore < 0.05) {
        continue;
      }

      const existingScore = maxScores.get(edge.from) ?? 0;
      if (nextScore > existingScore) {
        maxScores.set(edge.from, nextScore);
        depths.set(edge.from, curr.depth + 1);
        queue.push({ id: edge.from, score: nextScore, depth: curr.depth + 1 });
      }
    }
  }

  const directList: ImpactEntry[] = [];
  const transitiveList: ImpactEntry[] = [];

  for (const [id, score] of maxScores.entries()) {
    if (seedSet.has(id)) {
      continue;
    }
    const depth = depths.get(id) ?? 0;
    const entry = { id, score };
    if (depth === 1) {
      directList.push(entry);
    } else if (depth === 2 || depth === 3) {
      transitiveList.push(entry);
    }
  }

  const sortFn = (a: ImpactEntry, b: ImpactEntry) =>
    b.score - a.score || compareBytewise(a.id, b.id);

  return {
    direct: directList.sort(sortFn),
    transitive: transitiveList.sort(sortFn),
  };
}
