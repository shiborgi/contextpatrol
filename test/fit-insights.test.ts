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
    outlines: [
      {
        path: "src/a.ts",
        symbols: [{ qualifiedName: "src/a.ts#A", kind: "function", exported: true }],
      },
    ],
    referenceCensus: [{ qualifiedName: "src/a.ts#A", incomingCalls: 5 }],
    communities: [
      { id: "c-1", label: "src", memberCount: 2, topFiles: ["src/a.ts"], cohesion: 1 },
    ],
    routes: [{ id: "route:x", method: "GET", path: "/x", handler: null }],
    deadCode: [{ qualifiedName: "src/a.ts#A", confidence: 0.6 }],
    surprises: [
      { from: "src/a.ts#A", to: "src/b.ts#B", score: 2, reasons: ["cross-community"] },
    ],
    questions: [{ text: "What depends on A?", nodeId: "sym:src/a.ts#A" }],
    layers: [{ id: "layer:test", name: "Test", nodeIds: ["file:src/a.ts"] }],
    tour: [{ order: 1, nodeId: "file:src/a.ts" }],
    dirImports: [{ from: "src", to: "test", count: 1 }],
  };
}

const coverage = {
  unresolvedCalls: [],
  skipped: [],
  truncated: false,
  languagesSeen: ["typescript"],
  historyWindow: 2000,
  graphIntegrity: { missingSources: 0, missingTargets: 0 },
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
  assert.equal(graph.outlines, undefined);
  assert.equal(graph.referenceCensus, undefined);
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

test("drops outlines and referenceCensus first, then routes, etc.", () => {
  const sections = sectionsWithGraph();

  const withoutOutlines: Sections = {
    ...sections,
    graph: { ...sections.graph! },
  };
  delete withoutOutlines.graph!.outlines;
  delete withoutOutlines.graph!.referenceCensus;

  const result = fitOptionalInsights(
    sections,
    estimateTokens(canonicalJson(withoutOutlines)),
  );

  // outlines and referenceCensus dropped first
  assert.equal(result.graph?.outlines, undefined);
  assert.equal(result.graph?.referenceCensus, undefined);
  assert.ok(result.graph?.routes);
  assert.ok(result.graph?.communities);
  assert.ok(result.graph?.questions);
});

test("stepwise drop order: outlines -> referenceCensus -> routes -> deadCode -> surprises -> communities -> questions", () => {
  // Start with full, progressively lower the budget to force one drop at a time
  let result = sectionsWithGraph();

  // After dropping outlines + referenceCensus
  const noOutlines = { ...result, graph: { ...result.graph! } };
  delete noOutlines.graph!.outlines;
  delete noOutlines.graph!.referenceCensus;
  result = fitOptionalInsights(result, estimateTokens(canonicalJson(noOutlines)));
  assert.equal(result.graph?.outlines, undefined);
  assert.equal(result.graph?.referenceCensus, undefined);
  assert.ok(result.graph?.routes);
  assert.ok(result.graph?.deadCode);
  assert.ok(result.graph?.surprises);
  assert.ok(result.graph?.communities);
  assert.ok(result.graph?.questions);

  // After dropping routes
  const noRoutes = { ...result, graph: { ...result.graph! } };
  delete noRoutes.graph!.routes;
  result = fitOptionalInsights(result, estimateTokens(canonicalJson(noRoutes)));
  assert.equal(result.graph?.routes, undefined);
  assert.ok(result.graph?.deadCode);
  assert.ok(result.graph?.surprises);
  assert.ok(result.graph?.communities);
  assert.ok(result.graph?.questions);

  // After dropping deadCode
  const noDead = { ...result, graph: { ...result.graph! } };
  delete noDead.graph!.deadCode;
  result = fitOptionalInsights(result, estimateTokens(canonicalJson(noDead)));
  assert.equal(result.graph?.deadCode, undefined);
  assert.ok(result.graph?.surprises);
  assert.ok(result.graph?.communities);
  assert.ok(result.graph?.questions);

  // After dropping surprises
  const noSurprises = { ...result, graph: { ...result.graph! } };
  delete noSurprises.graph!.surprises;
  result = fitOptionalInsights(result, estimateTokens(canonicalJson(noSurprises)));
  assert.equal(result.graph?.surprises, undefined);
  assert.ok(result.graph?.communities);
  assert.ok(result.graph?.questions);

  // After dropping communities
  const noCommunities = { ...result, graph: { ...result.graph! } };
  delete noCommunities.graph!.communities;
  result = fitOptionalInsights(result, estimateTokens(canonicalJson(noCommunities)));
  assert.equal(result.graph?.communities, undefined);
  assert.ok(result.graph?.questions);

  // After dropping questions (only required fields + coverage remain)
  const noQuestions = { ...result, graph: { ...result.graph! } };
  delete noQuestions.graph!.questions;
  result = fitOptionalInsights(result, estimateTokens(canonicalJson(noQuestions)));
  assert.equal(result.graph?.questions, undefined);
  assert.ok(result.graph?.fileCount);
  assert.ok(result.graph?.godSymbols);
  assert.ok(result.coverage);

  // After dropping layers (7.2/7.3 fields drop next)
  const noLayers = { ...result, graph: { ...result.graph! } };
  delete noLayers.graph!.layers;
  result = fitOptionalInsights(result, estimateTokens(canonicalJson(noLayers)));
  assert.equal(result.graph?.layers, undefined);
  assert.ok(result.graph?.tour);

  // tour drops last before only required fields remain
  const noTour = { ...result, graph: { ...result.graph! } };
  delete noTour.graph!.tour;
  result = fitOptionalInsights(result, estimateTokens(canonicalJson(noTour)));
  assert.equal(result.graph?.tour, undefined);
  assert.ok(result.graph?.dirImports);

  // dirImports drops last before only required fields remain
  const noDirImports = { ...result, graph: { ...result.graph! } };
  delete noDirImports.graph!.dirImports;
  result = fitOptionalInsights(result, estimateTokens(canonicalJson(noDirImports)));
  assert.equal(result.graph?.dirImports, undefined);
  assert.ok(result.graph?.fileCount);
  assert.ok(result.graph?.godSymbols);
  assert.ok(result.coverage);
});

function manyOutlines(count: number): NonNullable<Sections["graph"]> {
  const outlines = [];
  for (let i = 0; i < count; i++) {
    outlines.push({
      path: `src/f${i}.ts`,
      symbols: [
        { qualifiedName: `src/f${i}.ts#F${i}`, kind: "function", exported: true },
      ],
    });
  }
  return {
    fileCount: count,
    symbolCount: count,
    edgeCount: count,
    godSymbols: [{ qualifiedName: "src/f0.ts#F0", score: 1 }],
    boundaryFiles: [],
    outlines,
  };
}

test("WORK-7.1.1 shrinks outlines to at most 10 when only a subset fits", () => {
  const sections: Sections = { graph: manyOutlines(20), coverage };
  const graph = sections.graph!;
  const outlines = graph.outlines!;
  // remaining budget that fits 10 outlines but not 20
  const ten = { ...sections, graph: { ...graph, outlines: outlines.slice(0, 10) } };
  const remaining = estimateTokens(canonicalJson(ten));
  const result = fitOptionalInsights(sections, remaining);
  assert.ok(result.graph?.outlines, "outlines should be present");
  assert.ok(result.graph.outlines.length <= 10, `got ${result.graph.outlines.length}`);
});

test("WORK-7.1.1 drops outlines entirely when even 5 do not fit", () => {
  const sections: Sections = { graph: manyOutlines(20), coverage };
  const graph = sections.graph!;
  const outlines = graph.outlines!;
  const five = { ...sections, graph: { ...graph, outlines: outlines.slice(0, 5) } };
  const tiny = estimateTokens(canonicalJson(five)) - 1;
  const result = fitOptionalInsights(sections, tiny);
  assert.equal(result.graph?.outlines, undefined);
  assert.equal(result.graph?.referenceCensus, undefined);
});
