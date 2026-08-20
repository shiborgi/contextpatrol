import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeGraph } from "../src/graph/code-graph.js";
import type { Community } from "../src/graph/communities.js";
import { detectSurprises } from "../src/graph/surprises.js";
import type { FileFact } from "../src/model.js";

function sym(id: string): { id: string; kind: "symbol" } {
  return { id: `sym:${id}`, kind: "symbol" };
}

function file(path: string, language: FileFact["language"], names: string[]): FileFact {
  return {
    path,
    language,
    size: 1,
    lines: 1,
    digest: "d",
    symbols: names.map((n) => ({
      kind: "function",
      name: n,
      qualifiedName: `${path}#${n}`,
      path,
      signature: "",
      jsdoc: "",
      source: "",
      range: { startLine: 1, endLine: 1 },
      exported: true,
      confidence: 1.0,
      isTest: false,
      heritage: { extends: [], implements: [] },
    })),
    imports: [],
    calls: [],
    rationale: [],
    routes: [],
  };
}

test("ranks cross-community edge as a surprise", () => {
  const graph: CodeGraph = {
    nodes: [sym("src/a.ts#A"), sym("src/b.ts#B")],
    edges: [
      {
        kind: "CALLS",
        from: "sym:src/a.ts#A",
        to: "sym:src/b.ts#B",
        confidence: 0.95,
        tier: "extracted",
      },
    ],
    unresolvedCallCensus: [],
  };
  const communities: Community[] = [
    { id: "c-1", label: "src", members: ["src/a.ts#A"], memberCount: 1, cohesion: 0 },
    { id: "c-2", label: "src", members: ["src/b.ts#B"], memberCount: 1, cohesion: 0 },
  ];
  const files = [
    file("src/a.ts", "typescript", ["A"]),
    file("src/b.ts", "typescript", ["B"]),
  ];

  const surprises = detectSurprises(graph, communities, [], files);
  assert.equal(surprises.length, 1);
  assert.equal(surprises[0]?.from, "src/a.ts#A");
  assert.equal(surprises[0]?.to, "src/b.ts#B");
  assert.ok(surprises[0]?.reasons.includes("cross-community"));
});

test("returns empty when no communities exist", () => {
  const graph: CodeGraph = {
    nodes: [sym("src/a.ts#A"), sym("src/b.ts#B")],
    edges: [
      {
        kind: "CALLS",
        from: "sym:src/a.ts#A",
        to: "sym:src/b.ts#B",
        confidence: 0.95,
        tier: "extracted",
      },
    ],
    unresolvedCallCensus: [],
  };
  const files = [
    file("src/a.ts", "typescript", ["A"]),
    file("src/b.ts", "typescript", ["B"]),
  ];
  assert.deepEqual(detectSurprises(graph, [], [], files), []);
});

test("scores cross-language and hub-periphery reasons", () => {
  const graph: CodeGraph = {
    nodes: [sym("src/a.ts#Hub"), sym("src/b.js#Leaf")],
    edges: [
      {
        kind: "CALLS",
        from: "sym:src/a.ts#Hub",
        to: "sym:src/b.js#Leaf",
        confidence: 0.95,
        tier: "extracted",
      },
    ],
    unresolvedCallCensus: [],
  };
  const communities: Community[] = [
    { id: "c-1", label: "src", members: ["src/a.ts#Hub"], memberCount: 1, cohesion: 0 },
    {
      id: "c-2",
      label: "src",
      members: ["src/b.js#Leaf"],
      memberCount: 1,
      cohesion: 0,
    },
  ];
  const files = [
    file("src/a.ts", "typescript", ["Hub"]),
    file("src/b.js", "javascript", ["Leaf"]),
  ];
  const godSymbols = [{ qualifiedName: "src/a.ts#Hub", score: 5 }];

  const surprises = detectSurprises(graph, communities, godSymbols, files);
  assert.equal(surprises.length, 1);
  const reasons = surprises[0]?.reasons ?? [];
  assert.ok(reasons.includes("cross-community"));
  assert.ok(reasons.includes("cross-language"));
  assert.ok(reasons.includes("hub-periphery"));
});
