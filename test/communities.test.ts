import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeGraph } from "../src/graph/code-graph.js";
import { detectCommunities } from "../src/graph/communities.js";

function sym(id: string): { id: string; kind: "symbol" } {
  return { id: `sym:${id}`, kind: "symbol" };
}

test("identical graphs produce identical communities", () => {
  const g: CodeGraph = {
    nodes: [sym("src/a.ts#A"), sym("src/b.ts#B")],
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
        to: "sym:src/a.ts#A",
        confidence: 0.95,
        tier: "extracted",
      },
    ],
    unresolvedCallCensus: [],
  };
  const first = detectCommunities(g);
  const second = detectCommunities(g);
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.deepEqual(first[0]?.members, ["src/a.ts#A", "src/b.ts#B"]);
});

test("oversized communities are subdivided by pruning weak edges", () => {
  // Two dense groups (a1-a2, b1-b2) linked only by weak IMPORTS projection.
  // CALLS edges (weight 1.0) keep each pair together; IMPORTS projection
  // (weight 0.5) is the weakest edge and is pruned first, splitting the groups.
  const g: CodeGraph = {
    nodes: [
      sym("src/a.ts#a1"),
      sym("src/a.ts#a2"),
      sym("src/b.ts#b1"),
      sym("src/b.ts#b2"),
      { id: "file:src/a.ts", kind: "file" },
      { id: "file:src/b.ts", kind: "file" },
    ],
    edges: [
      {
        kind: "CONTAINS",
        from: "file:src/a.ts",
        to: "sym:src/a.ts#a1",
        confidence: 1.0,
        tier: "extracted",
      },
      {
        kind: "CONTAINS",
        from: "file:src/a.ts",
        to: "sym:src/a.ts#a2",
        confidence: 1.0,
        tier: "extracted",
      },
      {
        kind: "CONTAINS",
        from: "file:src/b.ts",
        to: "sym:src/b.ts#b1",
        confidence: 1.0,
        tier: "extracted",
      },
      {
        kind: "CONTAINS",
        from: "file:src/b.ts",
        to: "sym:src/b.ts#b2",
        confidence: 1.0,
        tier: "extracted",
      },
      {
        kind: "IMPORTS",
        from: "file:src/a.ts",
        to: "file:src/b.ts",
        confidence: 1.0,
        tier: "extracted",
      },
      {
        kind: "CALLS",
        from: "sym:src/a.ts#a1",
        to: "sym:src/a.ts#a2",
        confidence: 0.95,
        tier: "extracted",
      },
      {
        kind: "CALLS",
        from: "sym:src/b.ts#b1",
        to: "sym:src/b.ts#b2",
        confidence: 0.95,
        tier: "extracted",
      },
    ],
    unresolvedCallCensus: [],
  };

  const communities = detectCommunities(g);
  // total = 4, oversizeLimit = max(2, ceil(1)) = 2; every community must be <= 2.
  assert.ok(
    communities.length >= 2,
    `expected >=2 communities, got ${communities.length}`,
  );
  for (const c of communities) {
    assert.ok(
      c.memberCount <= 2,
      `community ${c.id} exceeds limit with ${c.memberCount}`,
    );
  }
});

test("empty and edgeless graphs produce no communities", () => {
  assert.deepEqual(
    detectCommunities({ nodes: [], edges: [], unresolvedCallCensus: [] }),
    [],
  );
  const edgeless: CodeGraph = {
    nodes: [sym("src/a.ts#A"), sym("src/b.ts#B")],
    edges: [],
    unresolvedCallCensus: [],
  };
  assert.deepEqual(detectCommunities(edgeless), []);
});
