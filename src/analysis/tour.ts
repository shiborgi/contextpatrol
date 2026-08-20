import type { CodeGraph } from "./../graph/code-graph.js";
import { compareBytewise } from "../hash.js";

export interface TourStep {
  order: number;
  nodeId: string;
}

export const TOUR_MIN = 5;
export const TOUR_MAX = 12;

// WORK-7.3.2: deterministic BFS from the top entry over IMPORTS (file->file)
// and CONTAINS (file->sym) edges. Adjacency is visited bytewise so the reading
// order is reproducible. Only nodes present in the graph are emitted; when fewer
// than TOUR_MIN nodes are reachable the tour is empty (field will be omitted).
export function buildTour(graph: CodeGraph, topEntryPath: string): TourStep[] {
  const start = `file:${topEntryPath}`;
  if (!graph.nodes.some((n) => n.id === start)) {
    return [];
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== "IMPORTS" && edge.kind !== "CONTAINS") {
      continue;
    }
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  for (const list of adjacency.values()) {
    list.sort(compareBytewise);
  }

  const present = new Set(graph.nodes.map((n) => n.id));
  const visited = new Set<string>([start]);
  const queue: string[] = [start];
  const order: string[] = [start];

  while (queue.length > 0 && order.length < TOUR_MAX) {
    const current = queue.shift()!;
    const next = adjacency.get(current) ?? [];
    for (const neighbor of next) {
      if (order.length >= TOUR_MAX) {
        break;
      }
      if (!present.has(neighbor) || visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      queue.push(neighbor);
      order.push(neighbor);
    }
  }

  if (order.length < TOUR_MIN) {
    return [];
  }

  return order.map((nodeId, i) => ({ order: i + 1, nodeId }));
}
