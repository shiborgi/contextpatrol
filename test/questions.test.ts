import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeGraph } from "../src/graph/code-graph.js";
import type { Community } from "../src/graph/communities.js";
import { generateQuestions } from "../src/graph/questions.js";
import type { FileFact } from "../src/model.js";

const files: FileFact[] = [
  {
    path: "src/auth.ts",
    language: "typescript",
    size: 1,
    lines: 1,
    digest: "d",
    symbols: [
      {
        kind: "class",
        name: "AuthService",
        qualifiedName: "src/auth.ts#AuthService",
        path: "src/auth.ts",
        signature: "",
        jsdoc: "",
        source: "",
        range: { startLine: 1, endLine: 1 },
        exported: true,
        confidence: 1.0,
        isTest: false,
        heritage: { extends: [], implements: [] },
      },
    ],
    imports: [],
    calls: [],
    rationale: [],
    routes: [],
  },
];

test("generates questions from available signals referencing real ids", () => {
  const graph: CodeGraph = {
    nodes: [{ id: "sym:src/auth.ts#AuthService", kind: "symbol" }],
    edges: [],
    unresolvedCallCensus: [],
  };
  const communities: Community[] = [
    { id: "c-abc", members: ["src/auth.ts#AuthService"], memberCount: 1, cohesion: 0 },
  ];
  const godSymbols = [{ qualifiedName: "src/auth.ts#AuthService", score: 3 }];
  const surprises = [
    {
      from: "src/auth.ts#AuthService",
      to: "src/other.ts#X",
      score: 3,
      reasons: ["cross-community"],
    },
  ];
  const deadCode = [{ qualifiedName: "src/auth.ts#AuthService", confidence: 0.6 }];

  const questions = generateQuestions({
    graph,
    communities,
    godSymbols,
    surprises,
    deadCode,
    fileFacts: files,
  });

  assert.ok(questions.length >= 3);
  assert.ok(
    questions.every((q) => q.nodeId.startsWith("sym:") || q.nodeId.startsWith("file:")),
  );
  assert.ok(questions[0]?.text.includes("depends on"));
});

test("emits no fabricated questions when no signals exist", () => {
  const graph: CodeGraph = { nodes: [], edges: [], unresolvedCallCensus: [] };
  const questions = generateQuestions({
    graph,
    communities: [],
    godSymbols: [],
    surprises: [],
    deadCode: [],
    fileFacts: [],
  });
  assert.deepEqual(questions, []);
});
