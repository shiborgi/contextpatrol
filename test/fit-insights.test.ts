import assert from "node:assert/strict";
import { test } from "node:test";

import { estimateTokens } from "../src/budget.js";
import type { Sections } from "../src/contracts.js";
import { canonicalJson } from "../src/hash.js";
import { fitOptionalInsights } from "../src/pipeline/emit.js";

function graphSection() {
  return {
    fileCount: 3,
    symbolCount: 3,
    edgeCount: 3,
    godSymbols: [{ qualifiedName: "src/a.ts#A", score: 2 }],
    boundaryFiles: [],
    communities: [{ id: "c-1", memberCount: 2, topFiles: ["src/a.ts"], cohesion: 1 }],
    routes: [{ id: "route:x", method: "GET", path: "/x", handler: null }],
    deadCode: [{ qualifiedName: "src/a.ts#A", confidence: 0.6 }],
    surprises: [
      { from: "src/a.ts#A", to: "src/b.ts#B", score: 2, reasons: ["cross-community"] },
    ],
    questions: [{ text: "What depends on A?", nodeId: "sym:src/a.ts#A" }],
  };
}

const coverage = {
  unresolvedCalls: [],
  skipped: [],
  truncated: false,
  languagesSeen: ["typescript"],
  historyWindow: 2000,
};

function sectionsWithGraph(): Sections {
  return { graph: graphSection(), coverage };
}

test("keeps all insights when remaining budget is large", () => {
  const sections = sectionsWithGraph();
  const result = fitOptionalInsights(sections, Number.POSITIVE_INFINITY);
  assert.deepEqual(result, sections);
});

test("drops every optional insight when remaining is zero, keeping required fields", () => {
  const result = fitOptionalInsights(sectionsWithGraph(), 0);
  const graph = result.graph;
  assert.ok(graph);
  assert.equal(graph.communities, undefined);
  assert.equal(graph.routes, undefined);
  assert.equal(graph.deadCode, undefined);
  assert.equal(graph.surprises, undefined);
  assert.equal(graph.questions, undefined);
  // required graph fields and coverage survive
  assert.equal(graph.fileCount, 3);
  assert.equal(graph.symbolCount, 3);
  assert.equal(graph.edgeCount, 3);
  assert.ok(graph.godSymbols);
  assert.ok(result.coverage);
});

test("drops questions first, then surprises, respecting the fixed order", () => {
  const sections = sectionsWithGraph();

  const withoutQuestions: Sections = {
    ...sections,
    graph: { ...sections.graph! },
  };
  delete withoutQuestions.graph!.questions;

  const result = fitOptionalInsights(
    sections,
    estimateTokens(canonicalJson(withoutQuestions)),
  );

  // only questions is dropped; surprises and the rest remain
  assert.equal(result.graph?.questions, undefined);
  assert.ok(result.graph?.surprises);
  assert.ok(result.graph?.deadCode);
  assert.ok(result.graph?.routes);
  assert.ok(result.graph?.communities);
});
