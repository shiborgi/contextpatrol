import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCodeGraph } from "../src/graph/code-graph.js";
import type { FileFact } from "../src/model.js";

const FIXTURES: FileFact[] = [
  {
    path: "src/auth.ts",
    language: "typescript",
    size: 200,
    lines: 10,
    digest: "a1",
    symbols: [
      {
        kind: "class",
        name: "AuthService",
        qualifiedName: "src/auth.ts#AuthService",
        path: "src/auth.ts",
        signature: "class AuthService",
        jsdoc: "",
        source: "",
        range: { startLine: 1, endLine: 5 },
        exported: true,
        confidence: 1.0,
        isTest: false,
        heritage: { extends: ["BaseService"], implements: ["IAuth"] },
      },
      {
        kind: "method",
        name: "rotate",
        qualifiedName: "src/auth.ts#AuthService.rotate",
        path: "src/auth.ts",
        signature: "rotate()",
        jsdoc: "",
        source: "",
        range: { startLine: 2, endLine: 4 },
        exported: false,
        confidence: 1.0,
        isTest: false,
        heritage: { extends: [], implements: [] },
      },
      {
        kind: "interface",
        name: "IAuth",
        qualifiedName: "src/auth.ts#IAuth",
        path: "src/auth.ts",
        signature: "interface IAuth",
        jsdoc: "",
        source: "",
        range: { startLine: 6, endLine: 8 },
        exported: true,
        confidence: 1.0,
        isTest: false,
        heritage: { extends: [], implements: [] },
      },
      {
        kind: "class",
        name: "BaseService",
        qualifiedName: "src/auth.ts#BaseService",
        path: "src/auth.ts",
        signature: "class BaseService",
        jsdoc: "",
        source: "",
        range: { startLine: 9, endLine: 10 },
        exported: true,
        confidence: 1.0,
        isTest: false,
        heritage: { extends: [], implements: [] },
      },
    ],
    imports: [],
    calls: [
      {
        callerQualifiedName: "src/auth.ts#AuthService.rotate",
        calleeText: "this.tokenize",
        receiver: "this",
        range: { startLine: 3, endLine: 3 },
      },
    ],
    rationale: [],
    routes: [],
  },
  {
    path: "src/index.ts",
    language: "typescript",
    size: 150,
    lines: 8,
    digest: "a2",
    symbols: [
      {
        kind: "function",
        name: "main",
        qualifiedName: "src/index.ts#main",
        path: "src/index.ts",
        signature: "function main()",
        jsdoc: "",
        source: "",
        range: { startLine: 1, endLine: 8 },
        exported: true,
        confidence: 1.0,
        isTest: false,
        heritage: { extends: [], implements: [] },
      },
    ],
    imports: [
      {
        kind: "named",
        importedName: "AuthService",
        moduleSpecifier: "./auth",
        range: { startLine: 1, endLine: 1 },
      },
    ],
    calls: [
      {
        callerQualifiedName: "src/index.ts#main",
        calleeText: "AuthService",
        receiver: "identifier",
        range: { startLine: 3, endLine: 3 },
      },
      {
        callerQualifiedName: "src/index.ts#main",
        calleeText: "unresolvedFunc",
        receiver: "identifier",
        range: { startLine: 4, endLine: 4 },
      },
    ],
    rationale: [],
    routes: [],
  },
  {
    path: "test/auth.test.ts",
    language: "typescript",
    size: 100,
    lines: 5,
    digest: "a3",
    symbols: [
      {
        kind: "function",
        name: "testAuth",
        qualifiedName: "test/auth.test.ts#testAuth",
        path: "test/auth.test.ts",
        signature: "function testAuth()",
        jsdoc: "",
        source: "",
        range: { startLine: 1, endLine: 5 },
        exported: false,
        confidence: 1.0,
        isTest: true,
        heritage: { extends: [], implements: [] },
      },
    ],
    imports: [
      {
        kind: "named",
        importedName: "AuthService",
        moduleSpecifier: "../src/auth",
        range: { startLine: 1, endLine: 1 },
      },
    ],
    calls: [],
    rationale: [],
    routes: [],
  },
];

const ELIGIBLE = ["src/auth.ts", "src/index.ts", "test/auth.test.ts"];

test("buildCodeGraph extracts CONTAINS and IMPORTS edges", () => {
  const g = buildCodeGraph(FIXTURES, ELIGIBLE);
  const contains = g.edges.filter((e) => e.kind === "CONTAINS");
  assert.equal(contains.length, 6); // 4 in auth.ts, 1 in index.ts, 1 in auth.test.ts
  assert.ok(
    contains.some(
      (e) => e.from === "file:src/auth.ts" && e.to === "sym:src/auth.ts#AuthService",
    ),
  );

  const imports = g.edges.filter((e) => e.kind === "IMPORTS");
  assert.equal(imports.length, 2);
  assert.ok(
    imports.some((e) => e.from === "file:src/index.ts" && e.to === "file:src/auth.ts"),
  );
});

test("extracts INHERITS and IMPLEMENTS edges from heritage", () => {
  const g = buildCodeGraph(FIXTURES, ELIGIBLE);
  const inherits = g.edges.find((e) => e.kind === "INHERITS");
  const implementsEdge = g.edges.find((e) => e.kind === "IMPLEMENTS");

  assert.ok(inherits);
  assert.equal(inherits.from, "sym:src/auth.ts#AuthService");
  assert.equal(inherits.to, "sym:src/auth.ts#BaseService");
  assert.equal(inherits.confidence, 0.95);

  assert.ok(implementsEdge);
  assert.equal(implementsEdge.from, "sym:src/auth.ts#AuthService");
  assert.equal(implementsEdge.to, "sym:src/auth.ts#IAuth");
});

test("resolves CALLS with correct confidence tiers, census and zero-edge guarantee", () => {
  const g = buildCodeGraph(FIXTURES, ELIGIBLE);
  const calls = g.edges.filter((e) => e.kind === "CALLS");

  // AuthService resolves main call via imports (0.90)
  const authCall = calls.find((e) => e.to === "sym:src/auth.ts#AuthService");
  assert.ok(authCall);
  assert.equal(authCall.from, "sym:src/index.ts#main");
  assert.equal(authCall.confidence, 0.9);

  // unresolvedFunc appears in census, no edge emitted
  const unresolved = calls.find((e) => e.to.includes("unresolved"));
  assert.equal(unresolved, undefined);

  const entry = g.unresolvedCallCensus.find(
    (c) => c.callerQualifiedName === "src/index.ts#main",
  );
  assert.ok(entry);
  assert.equal(entry.count, 1);

  // this.tokenize appears in census of AuthService.rotate
  const rotateEntry = g.unresolvedCallCensus.find(
    (c) => c.callerQualifiedName === "src/auth.ts#AuthService.rotate",
  );
  assert.ok(rotateEntry);
  assert.equal(rotateEntry.count, 1);
});

test("infers TESTED_BY edges", () => {
  const g = buildCodeGraph(FIXTURES, ELIGIBLE);
  const testedBy = g.edges.filter((e) => e.kind === "TESTED_BY");

  assert.equal(testedBy.length, 1);
  assert.equal(testedBy[0]?.from, "file:test/auth.test.ts");
  assert.equal(testedBy[0]?.to, "file:src/auth.ts");
  assert.equal(testedBy[0]?.confidence, 0.8);
  assert.equal(testedBy[0]?.tier, "inferred");
});

test("tested-by fallback matches by path stem without imports", () => {
  const noImportsTest: FileFact[] = [
    {
      path: "src/util.ts",
      language: "typescript",
      size: 50,
      lines: 2,
      digest: "u1",
      symbols: [],
      imports: [],
      calls: [],
      rationale: [],
      routes: [],
    },
    {
      path: "test/util.test.ts",
      language: "typescript",
      size: 50,
      lines: 2,
      digest: "u2",
      symbols: [],
      imports: [],
      calls: [],
      rationale: [],
      routes: [],
    },
  ];
  const g = buildCodeGraph(noImportsTest, ["src/util.ts", "test/util.test.ts"]);
  const testedBy = g.edges.filter((e) => e.kind === "TESTED_BY");
  assert.equal(testedBy.length, 1);
  assert.equal(testedBy[0]?.from, "file:test/util.test.ts");
  assert.equal(testedBy[0]?.to, "file:src/util.ts");
  assert.equal(testedBy[0]?.confidence, 0.7);
});

test("graph building is deterministic", () => {
  const a = buildCodeGraph(FIXTURES, ELIGIBLE);
  const b = buildCodeGraph(FIXTURES, ELIGIBLE);
  assert.deepEqual(a, b);
});

test("NodeNext .js imports produce IMPORTS and import-scoped CALLS edges", () => {
  const files: FileFact[] = [
    {
      path: "src/a.ts",
      language: "typescript",
      size: 50,
      lines: 2,
      digest: "n1",
      symbols: [
        {
          kind: "function",
          name: "caller",
          qualifiedName: "src/a.ts#caller",
          path: "src/a.ts",
          signature: "function caller()",
          jsdoc: "",
          source: "",
          range: { startLine: 1, endLine: 2 },
          exported: true,
          confidence: 1.0,
          isTest: false,
          heritage: { extends: [], implements: [] },
        },
      ],
      imports: [
        {
          kind: "named",
          importedName: "fn",
          moduleSpecifier: "./lib.js",
          range: { startLine: 1, endLine: 1 },
        },
      ],
      calls: [
        {
          callerQualifiedName: "src/a.ts#caller",
          calleeText: "fn",
          receiver: "identifier",
          range: { startLine: 2, endLine: 2 },
        },
      ],
      rationale: [],
      routes: [],
    },
    {
      path: "src/lib.ts",
      language: "typescript",
      size: 50,
      lines: 2,
      digest: "n2",
      symbols: [
        {
          kind: "function",
          name: "fn",
          qualifiedName: "src/lib.ts#fn",
          path: "src/lib.ts",
          signature: "function fn()",
          jsdoc: "",
          source: "",
          range: { startLine: 1, endLine: 2 },
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
  const g = buildCodeGraph(files, ["src/a.ts", "src/lib.ts"]);

  assert.ok(
    g.edges.some(
      (e) =>
        e.kind === "IMPORTS" &&
        e.from === "file:src/a.ts" &&
        e.to === "file:src/lib.ts",
    ),
  );
  assert.ok(
    g.edges.some(
      (e) =>
        e.kind === "CALLS" &&
        e.from === "sym:src/a.ts#caller" &&
        e.to === "sym:src/lib.ts#fn",
    ),
  );
});
