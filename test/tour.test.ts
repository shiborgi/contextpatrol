import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTour, TOUR_MAX, TOUR_MIN } from "../src/analysis/tour.js";
import type { CodeGraph } from "../src/graph/code-graph.js";

function makeGraph(
  nodes: string[],
  edges: Array<{ kind: "IMPORTS" | "CONTAINS"; from: string; to: string }>,
): CodeGraph {
  return {
    nodes: nodes.map((id) => ({
      id,
      kind: (id.startsWith("sym:") ? "symbol" : "file") as "file" | "symbol",
    })),
    edges: edges.map((e) => ({ ...e, confidence: 1, tier: "extracted" })),
    unresolvedCallCensus: [],
  };
}

const FILE = [
  "file:src/cli.ts",
  "file:src/pack.ts",
  "file:src/contracts.ts",
  "file:src/hash.ts",
  "file:src/security.ts",
  "file:src/budget.ts",
];

test("WORK-7.3.2 tour starts at the top entry and grows with IMPORTS/CONTAINS", () => {
  const graph = makeGraph(
    [
      "file:src/cli.ts",
      "file:src/pack.ts",
      "file:src/contracts.ts",
      "file:src/hash.ts",
      "sym:src/cli.ts#runCli",
      "sym:src/pack.ts#pack",
    ],
    [
      { kind: "IMPORTS", from: "file:src/cli.ts", to: "file:src/pack.ts" },
      { kind: "IMPORTS", from: "file:src/pack.ts", to: "file:src/contracts.ts" },
      { kind: "IMPORTS", from: "file:src/pack.ts", to: "file:src/hash.ts" },
      { kind: "CONTAINS", from: "file:src/cli.ts", to: "sym:src/cli.ts#runCli" },
      { kind: "CONTAINS", from: "file:src/pack.ts", to: "sym:src/pack.ts#pack" },
    ],
  );
  const tour = buildTour(graph, "src/cli.ts");
  assert.ok(tour.length > 0, "expected non-empty tour for this graph");
  const first = tour[0]!;
  assert.equal(first.nodeId, "file:src/cli.ts");
  assert.equal(first.order, 1);
  for (let i = 0; i < tour.length; i++) {
    assert.equal(tour[i]!.order, i + 1);
  }
  assert.ok(tour.length >= TOUR_MIN && tour.length <= TOUR_MAX);
  for (const step of tour) {
    assert.ok(
      graph.nodes.some((n) => n.id === step.nodeId),
      `missing ${step.nodeId}`,
    );
  }
});

test("WORK-7.3.2 returns empty when fewer than TOUR_MIN nodes are reachable", () => {
  const graph = makeGraph(FILE, [
    { kind: "IMPORTS", from: "file:src/cli.ts", to: "file:src/pack.ts" },
  ]);
  const tour = buildTour(graph, "src/cli.ts");
  assert.equal(tour.length, 0);
});

test("WORK-7.3.2 BFS is deterministic", () => {
  const graph = makeGraph(FILE, [
    { kind: "IMPORTS", from: "file:src/cli.ts", to: "file:src/pack.ts" },
    { kind: "IMPORTS", from: "file:src/cli.ts", to: "file:src/hash.ts" },
    { kind: "IMPORTS", from: "file:src/pack.ts", to: "file:src/contracts.ts" },
    { kind: "IMPORTS", from: "file:src/pack.ts", to: "file:src/security.ts" },
    { kind: "IMPORTS", from: "file:src/hash.ts", to: "file:src/budget.ts" },
    { kind: "IMPORTS", from: "file:src/budget.ts", to: "file:src/contracts.ts" },
  ]);
  const a = buildTour(graph, "src/cli.ts");
  const b = buildTour(graph, "src/cli.ts");
  assert.deepEqual(
    a.map((s) => s.nodeId),
    b.map((s) => s.nodeId),
  );
});
