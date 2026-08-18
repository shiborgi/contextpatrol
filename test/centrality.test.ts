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
    { id: "sym:src/auth.ts#constructor", kind: "symbol" }, // Noise node
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
      to: "sym:src/auth.ts#constructor", // Call to noise
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

test("computeCentrality computes in-degree over symbols and excludes noise", () => {
  const { godSymbols, boundaryFiles } = computeCentrality(GRAPH);

  // 'helper' has in-degree 2 (from rotate and AuthService)
  const helper = godSymbols.find((g) => g.qualifiedName === "src/auth.ts#helper");
  assert.ok(helper);
  assert.equal(helper.score, 2);

  // 'constructor' is noise, must be excluded
  const constructorNode = godSymbols.find(
    (g) => g.qualifiedName === "src/auth.ts#constructor",
  );
  assert.equal(constructorNode, undefined);

  // 'boundaryFiles' should find 'src/auth.ts' because it was imported from 'test/auth.test.ts'
  // (different top-level dir: 'src' !== 'test')
  assert.deepEqual(boundaryFiles, ["src/auth.ts"]);
});
