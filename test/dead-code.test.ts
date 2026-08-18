import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeGraph } from "../src/graph/code-graph.js";
import { detectDeadCode } from "../src/graph/dead-code.js";
import type { FileFact } from "../src/model.js";

function makeFile(
  path: string,
  symbols: Array<{ name: string; exported: boolean; isTest?: boolean }>,
): FileFact {
  return {
    path,
    language: "typescript",
    size: 1,
    lines: 1,
    digest: "d",
    symbols: symbols.map((s) => ({
      kind: "function",
      name: s.name,
      qualifiedName: `${path}#${s.name}`,
      path,
      signature: "",
      jsdoc: "",
      source: "",
      range: { startLine: 1, endLine: 1 },
      exported: s.exported,
      confidence: 1.0,
      isTest: s.isTest ?? false,
      heritage: { extends: [], implements: [] },
    })),
    imports: [],
    calls: [],
    rationale: [],
    routes: [],
  };
}

test("lists exported unused symbols when the graph has CALLS edges", () => {
  const files = [
    makeFile("src/index.ts", [{ name: "main", exported: true }]),
    makeFile("src/auth.ts", [
      { name: "AuthService", exported: true },
      { name: "helper", exported: true },
      { name: "internal", exported: false },
    ]),
  ];
  const graph: CodeGraph = {
    nodes: [
      { id: "sym:src/index.ts#main", kind: "symbol" },
      { id: "sym:src/auth.ts#AuthService", kind: "symbol" },
      { id: "sym:src/auth.ts#helper", kind: "symbol" },
    ],
    edges: [
      {
        kind: "CALLS",
        from: "sym:src/index.ts#main",
        to: "sym:src/auth.ts#AuthService",
        confidence: 0.9,
        tier: "extracted",
      },
    ],
    unresolvedCallCensus: [],
  };

  const dead = detectDeadCode(graph, files);
  const names = dead.map((d) => d.qualifiedName);
  // AuthService is called; main is entry; internal not exported; helper is unused.
  assert.deepEqual(names, ["src/auth.ts#helper"]);
  assert.equal(dead[0]?.confidence, 0.6);
});

test("suppresses the claim when the graph has zero CALLS edges", () => {
  const files = [makeFile("src/auth.ts", [{ name: "helper", exported: true }])];
  const graph: CodeGraph = {
    nodes: [{ id: "sym:src/auth.ts#helper", kind: "symbol" }],
    edges: [],
    unresolvedCallCensus: [],
  };
  assert.deepEqual(detectDeadCode(graph, files), []);
});

test("excludes test and entry-point symbols", () => {
  const files = [
    makeFile("src/index.ts", [{ name: "main", exported: true }]),
    makeFile("src/auth.test.ts", [{ name: "testIt", exported: true, isTest: true }]),
  ];
  const graph: CodeGraph = {
    nodes: [],
    edges: [
      {
        kind: "CALLS",
        from: "sym:src/index.ts#main",
        to: "sym:src/index.ts#main",
        confidence: 0.9,
        tier: "extracted",
      },
    ],
    unresolvedCallCensus: [],
  };
  assert.deepEqual(detectDeadCode(graph, files), []);
});
