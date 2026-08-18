import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeGraph } from "../src/graph/code-graph.js";
import type { SymbolFact } from "../src/model.js";
import { rankSymbols, tokenizeAndExtract } from "../src/ranking.js";

test("tokenizeAndExtract splits camel/snake and extracts identifier-shaped tokens", () => {
  const { terms, identifiers } = tokenizeAndExtract(
    "locate AuthService.rotate in retry_count",
  );

  // Split terms: locate, auth, service, rotate, retry, count
  assert.ok(terms.includes("locate"));
  assert.ok(terms.includes("auth"));
  assert.ok(terms.includes("service"));
  assert.ok(terms.includes("rotate"));
  assert.ok(terms.includes("retry"));
  assert.ok(terms.includes("count"));

  // Extracted identifiers: AuthService.rotate, retry_count
  assert.ok(identifiers.includes("AuthService.rotate"));
  assert.ok(identifiers.includes("retry_count"));
});

test("rankSymbols boosts qualified-name matches and merges with RRF", () => {
  const symbols: SymbolFact[] = [
    {
      kind: "method",
      name: "rotate",
      qualifiedName: "src/auth.ts#AuthService.rotate",
      path: "src/auth.ts",
      signature: "",
      jsdoc: "",
      source: "",
      range: { startLine: 1, endLine: 2 },
      exported: true,
      confidence: 1.0,
      isTest: false,
      heritage: { extends: [], implements: [] },
    },
    {
      kind: "function",
      name: "helper",
      qualifiedName: "src/auth.ts#helper",
      path: "src/auth.ts",
      signature: "",
      jsdoc: "",
      source: "",
      range: { startLine: 3, endLine: 4 },
      exported: true,
      confidence: 1.0,
      isTest: false,
      heritage: { extends: [], implements: [] },
    },
  ];

  const graph: CodeGraph = { nodes: [], edges: [], unresolvedCallCensus: [] };
  // Intent contains identifier 'AuthService.rotate' -> should boost the first symbol
  const ranked = rankSymbols(symbols, "AuthService.rotate", graph, new Set(), []);

  assert.equal(ranked[0]?.qualifiedName, "src/auth.ts#AuthService.rotate");
});
