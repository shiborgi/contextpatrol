import { compareBytewise, sha256Hex } from "../hash.js";
import type { CodeGraph } from "./code-graph.js";

export interface Community {
  id: string;
  members: string[]; // symbol qualified names (sym: prefix stripped)
  memberCount: number;
  cohesion: number;
}

const OVERSIZE_FRACTION = 0.25;
const LOW_COHESION_THRESHOLD = 0.1;
const LARGE_COMMUNITY_SIZE = 20;

// Edge weights: CALLS is a stronger co-membership signal than IMPORTS.
const CALLS_WEIGHT = 1.0;
const IMPORTS_WEIGHT = 0.5;

type Adjacency = Map<string, Map<string, number>>;

/**
 * Deterministic community detection over symbol nodes: connected components
 * over CALLS edges and IMPORTS edges projected onto contained symbols, with
 * recursive pruning of the weakest edge for oversized communities. Pure
 * function of the graph: no RNG, bytewise tie-breaks.
 */
export function detectCommunities(graph: CodeGraph): Community[] {
  const symbolIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "symbol") {
      symbolIds.add(node.id);
    }
  }
  if (symbolIds.size === 0) {
    return [];
  }

  const hasEdge = graph.edges.some((e) => e.kind === "CALLS" || e.kind === "IMPORTS");
  if (!hasEdge) {
    return [];
  }

  const adjacency = buildAdjacency(graph);
  const total = symbolIds.size;
  const oversizeLimit = Math.max(2, Math.ceil(total * OVERSIZE_FRACTION));

  const components = connectedComponents([...symbolIds], adjacency);

  const final: string[][] = [];
  for (const comp of components) {
    final.push(...pruneComponent(comp, adjacency, oversizeLimit));
  }

  return final
    .filter((members) => members.length >= 2)
    .map((members) => toCommunity(members, adjacency))
    .sort((a, b) => b.memberCount - a.memberCount || compareBytewise(a.id, b.id));
}

function stripPrefix(id: string): string {
  return id.startsWith("sym:") ? id.slice(4) : id;
}

function buildAdjacency(graph: CodeGraph): Adjacency {
  const adjacency: Adjacency = new Map();

  const addUndirected = (a: string, b: string, weight: number): void => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Map());
    if (!adjacency.has(b)) adjacency.set(b, new Map());
    const aw = adjacency.get(a)!;
    const bw = adjacency.get(b)!;
    // Keep the strongest weight for each neighbour pair.
    aw.set(b, Math.max(aw.get(b) ?? 0, weight));
    bw.set(a, Math.max(bw.get(a) ?? 0, weight));
  };

  const fileSymbols = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind === "CONTAINS" && edge.to.startsWith("sym:")) {
      const list = fileSymbols.get(edge.from) ?? [];
      list.push(edge.to);
      fileSymbols.set(edge.from, list);
    }
  }

  for (const edge of graph.edges) {
    if (
      edge.kind === "CALLS" &&
      edge.from.startsWith("sym:") &&
      edge.to.startsWith("sym:")
    ) {
      addUndirected(edge.from, edge.to, CALLS_WEIGHT);
    } else if (edge.kind === "IMPORTS") {
      const fromSyms = fileSymbols.get(edge.from) ?? [];
      const toSyms = fileSymbols.get(edge.to) ?? [];
      for (const a of fromSyms) {
        for (const b of toSyms) {
          addUndirected(a, b, IMPORTS_WEIGHT);
        }
      }
    }
  }

  return adjacency;
}

function connectedComponents(ids: string[], adjacency: Adjacency): string[][] {
  const members = new Set(ids);
  const visited = new Set<string>();
  const components: string[][] = [];

  const sorted = [...members].sort(compareBytewise);
  for (const start of sorted) {
    if (visited.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      comp.push(node);
      const neighbours = adjacency.get(node);
      if (neighbours) {
        for (const n of [...neighbours.keys()].sort(compareBytewise)) {
          if (members.has(n) && !visited.has(n)) {
            stack.push(n);
          }
        }
      }
    }
    components.push(comp);
  }

  return components;
}

function pruneComponent(
  comp: string[],
  adjacency: Adjacency,
  oversizeLimit: number,
): string[][] {
  // Stop when the component satisfies both the legacy oversize rule and the
  // low-cohesion large-community rule.
  if (
    comp.length <= oversizeLimit &&
    (comp.length <= LARGE_COMMUNITY_SIZE ||
      cohesionOf(comp, adjacency) >= LOW_COHESION_THRESHOLD)
  ) {
    return [comp];
  }

  // Iteratively remove the weakest edge until the component splits into
  // multiple connected components, or until no internal edges remain.
  const current = comp;
  while (
    current.length > oversizeLimit ||
    (current.length > LARGE_COMMUNITY_SIZE &&
      cohesionOf(current, adjacency) < LOW_COHESION_THRESHOLD)
  ) {
    const weakest = weakestEdge(current, adjacency);
    if (!weakest) {
      break;
    }
    adjacency.get(weakest.a)?.delete(weakest.b);
    adjacency.get(weakest.b)?.delete(weakest.a);

    const sub = connectedComponents(current, adjacency);
    if (sub.length > 1) {
      const result: string[][] = [];
      for (const part of sub) {
        result.push(...pruneComponent(part, adjacency, oversizeLimit));
      }
      return result;
    }
  }

  return [current];
}

function weakestEdge(
  comp: string[],
  adjacency: Adjacency,
): { a: string; b: string } | null {
  const members = new Set(comp);
  let best: { a: string; b: string; weight: number } | null = null;
  for (const a of [...comp].sort(compareBytewise)) {
    const neighbours = adjacency.get(a);
    if (!neighbours) continue;
    for (const b of [...neighbours.keys()].sort(compareBytewise)) {
      if (!members.has(b)) continue;
      // Only consider each undirected edge once (a < b).
      if (compareBytewise(a, b) >= 0) continue;
      const weight = neighbours.get(b) ?? 0;
      const key = `${a}\0${b}`;
      if (
        best === null ||
        weight < best.weight ||
        (weight === best.weight && compareBytewise(key, `${best.a}\0${best.b}`) < 0)
      ) {
        best = { a, b, weight };
      }
    }
  }
  return best ? { a: best.a, b: best.b } : null;
}

function cohesionOf(members: string[], adjacency: Adjacency): number {
  const set = new Set(members);
  let internal = 0;
  for (const m of members) {
    const neighbours = adjacency.get(m);
    if (!neighbours) continue;
    for (const n of neighbours.keys()) {
      if (set.has(n)) internal += 1;
    }
  }
  internal = internal / 2;
  const n = members.length;
  const possible = n > 1 ? (n * (n - 1)) / 2 : 1;
  return possible > 0 ? internal / possible : 0;
}

function toCommunity(members: string[], adjacency: Adjacency): Community {
  const sorted = [...members].sort(compareBytewise);
  const qualified = sorted.map(stripPrefix);
  const id = `c-${sha256Hex(qualified.join("\n")).slice(0, 8)}`;

  const cohesion = cohesionOf(sorted, adjacency);

  return {
    id,
    members: qualified,
    memberCount: qualified.length,
    cohesion: Number(cohesion.toFixed(4)),
  };
}
