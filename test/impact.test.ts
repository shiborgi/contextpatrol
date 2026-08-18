import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeGraph } from "../src/graph/code-graph.js";
import { computeImpact } from "../src/graph/impact.js";

// Cyclic graph: A -> B -> C -> A
const CYCLIC_GRAPH: CodeGraph = {
  nodes: [
    { id: "sym:src/a.ts#A", kind: "symbol" },
    { id: "sym:src/b.ts#B", kind: "symbol" },
    { id: "sym:src/c.ts#C", kind: "symbol" },
  ],
  edges: [
    {
      kind: "CALLS",
      from: "sym:src/a.ts#A",
      to: "sym:src/b.ts#B",
      confidence: 0.95,
      tier: "extracted",
    },
    {
      kind: "CALLS",
      from: "sym:src/b.ts#B",
      to: "sym:src/c.ts#C",
      confidence: 0.95,
      tier: "extracted",
    },
    {
      kind: "CALLS",
      from: "sym:src/c.ts#C",
      to: "sym:src/a.ts#A",
      confidence: 0.95,
      tier: "extracted",
    },
  ],
  unresolvedCallCensus: [],
};

test("computeImpact terminates on cycles and groups by depth", () => {
  // If seed is A, reverse traversal will visit C (depth 1, score 0.5), then B (depth 2, score 0.25)
  // then A (depth 3, score 0.125, but seed has score 1.0, so no update)
  const res = computeImpact(CYCLIC_GRAPH, ["sym:src/a.ts#A"]);

  assert.equal(res.direct.length, 1);
  assert.equal(res.direct[0]?.id, "sym:src/c.ts#C");
  assert.equal(res.direct[0]?.score, 0.5);

  assert.equal(res.transitive.length, 1);
  assert.equal(res.transitive[0]?.id, "sym:src/b.ts#B");
  assert.equal(res.transitive[0]?.score, 0.25);
});

test("monotone decay and edge-kind weights are respected", () => {
  const graph: CodeGraph = {
    nodes: [
      { id: "file:src/x.ts", kind: "file" },
      { id: "file:src/y.ts", kind: "file" },
      { id: "sym:src/y.ts#Y", kind: "symbol" },
    ],
    edges: [
      // y.ts imports x.ts (IMPORTS edge, weight 0.8)
      {
        kind: "IMPORTS",
        from: "file:src/y.ts",
        to: "file:src/x.ts",
        confidence: 1.0,
        tier: "extracted",
      },
      // Y calls the file x.ts (CONTAINS links Y to y.ts)
      {
        kind: "CONTAINS",
        from: "file:src/y.ts",
        to: "sym:src/y.ts#Y",
        confidence: 1.0,
        tier: "extracted",
      },
    ],
    unresolvedCallCensus: [],
  };

  // Seed is x.ts. Reverse IMPORTS edge from y.ts.
  // score = 1.0 * 0.5 * 0.8 = 0.40
  const res = computeImpact(graph, ["file:src/x.ts"]);
  assert.equal(res.direct.length, 1);
  assert.equal(res.direct[0]?.id, "file:src/y.ts");
  assert.equal(res.direct[0]?.score, 0.4);
});
