import assert from "node:assert/strict";
import { test } from "node:test";

import { computeCentrality } from "../src/graph/centrality.js";
import type { CodeGraph } from "../src/graph/code-graph.js";

const GRAPH: CodeGraph = {
  nodes: [
    { id: "file:src/auth.ts", kind: "file" },
    { id: "file:test/auth.test.ts", kind: "file" },
    { id: "sym:src/auth.ts#AuthService", kind: "symbol" },
    { id: "sym:src/auth.ts#AuthService.rotate", kind: "symbol" },
    { id: "sym:src/auth.ts#helper", kind: "symbol" },
    { id: "sym:src/auth.ts#constructor", kind: "symbol" },
  ],
  edges: [
    {
      kind: "IMPORTS",
      from: "file:test/auth.test.ts",
      to: "file:src/auth.ts",
      confidence: 1.0,
      tier: "extracted",
    },
    {
      kind: "CALLS",
      from: "sym:src/auth.ts#AuthService.rotate",
      to: "sym:src/auth.ts#helper",
      confidence: 0.95,
      tier: "extracted",
    },
    {
      kind: "CALLS",
      from: "sym:src/auth.ts#AuthService.rotate",
      to: "sym:src/auth.ts#constructor",
      confidence: 0.95,
      tier: "extracted",
    },
    {
      kind: "CALLS",
      from: "sym:src/auth.ts#AuthService",
      to: "sym:src/auth.ts#helper",
      confidence: 0.95,
      tier: "extracted",
    },
  ],
  unresolvedCallCensus: [],
};

test("excludes non-exported same-file helpers from godSymbols", () => {
  const { godSymbols } = computeCentrality(GRAPH, new Set());
  assert.equal(
    godSymbols.find((g) => g.qualifiedName === "src/auth.ts#helper"),
    undefined,
  );
});

test("includes exported symbols as god-symbols", () => {
  const { godSymbols } = computeCentrality(GRAPH, new Set(["src/auth.ts#helper"]));
  const helper = godSymbols.find((g) => g.qualifiedName === "src/auth.ts#helper");
  assert.ok(helper);
  assert.equal(helper.score, 2);
});

test("includes cross-file-called symbols even when not exported", () => {
  const graph: CodeGraph = {
    ...GRAPH,
    edges: [
      ...GRAPH.edges,
      {
        kind: "CALLS",
        from: "sym:test/auth.test.ts#testAuth",
        to: "sym:src/auth.ts#helper",
        confidence: 0.9,
        tier: "extracted",
      },
    ],
  };
  const { godSymbols } = computeCentrality(graph, new Set());
  const helper = godSymbols.find((g) => g.qualifiedName === "src/auth.ts#helper");
  assert.ok(helper);
});

test("noise (constructor) is still excluded even when exported", () => {
  const { godSymbols } = computeCentrality(GRAPH, new Set(["src/auth.ts#constructor"]));
  assert.equal(
    godSymbols.find((g) => g.qualifiedName === "src/auth.ts#constructor"),
    undefined,
  );
});

test("boundaryFiles still finds cross-dir imports", () => {
  const { boundaryFiles } = computeCentrality(GRAPH);
  assert.deepEqual(boundaryFiles, ["src/auth.ts"]);
});
