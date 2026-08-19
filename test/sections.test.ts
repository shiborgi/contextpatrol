import assert from "node:assert/strict";
import { test } from "node:test";
import type { Analysis } from "../src/analysis/analysis.js";
import { buildCoverageSection, buildGraphSection } from "../src/analysis/sections.js";
import type { ScanResult } from "../src/snapshot.js";

function emptyScan(): ScanResult {
  return {
    fileFacts: [],
    fileManifest: [],
    eligiblePaths: [],
    truncated: false,
    dirtyDigest: "dirty",
    policyDigest: "policy",
    snapshotDigest: "snapshot",
    skipped: [],
    dirtyEntries: [],
    dirtyFiles: [],
  };
}

function emptyAnalysis(overrides?: Partial<Analysis>): Analysis {
  return {
    graph: {
      nodes: [],
      edges: [],
      unresolvedCallCensus: [],
    },
    godSymbols: [],
    boundaryFiles: [],
    changedSymbols: new Set(),
    churn: new Map(),
    maxChurn: 0,
    maxInDegree: 0,
    historyWindow: 2000,
    communities: [],
    deadCode: [],
    surprises: [],
    questions: [],
    ...overrides,
  };
}

test("buildGraphSection caps godSymbols at 20", () => {
  const analysis = emptyAnalysis({
    godSymbols: Array.from({ length: 25 }, (_, i) => ({
      qualifiedName: `src/a.ts#sym${String(i).padStart(2, "0")}`,
      score: 25 - i,
    })),
  });
  const section = buildGraphSection(analysis, emptyScan());
  assert.equal(section.godSymbols.length, 20);
  // highest scores kept first
  assert.equal(section.godSymbols[0]?.qualifiedName, "src/a.ts#sym00");
  assert.equal(section.godSymbols[19]?.qualifiedName, "src/a.ts#sym19");
});

test("buildGraphSection keeps deterministic tie-break on godSymbols", () => {
  const analysis = emptyAnalysis({
    // input is already score-desc then bytewise, as computeCentrality produces
    godSymbols: [
      { qualifiedName: "src/a.ts#A", score: 5 },
      { qualifiedName: "src/b.ts#B", score: 5 },
      { qualifiedName: "src/c.ts#C", score: 3 },
    ],
  });
  const section1 = buildGraphSection(analysis, emptyScan());
  const section2 = buildGraphSection(analysis, emptyScan());
  assert.deepEqual(section1.godSymbols, section2.godSymbols);
  assert.deepEqual(
    section1.godSymbols.map((g) => g.qualifiedName),
    ["src/a.ts#A", "src/b.ts#B", "src/c.ts#C"],
  );
});

test("buildCoverageSection caps unresolvedCalls at 50", () => {
  const analysis = emptyAnalysis({
    graph: {
      nodes: [],
      edges: [],
      unresolvedCallCensus: Array.from({ length: 55 }, (_, i) => ({
        callerQualifiedName: `src/a.ts#caller${String(i).padStart(2, "0")}`,
        count: i + 1,
      })),
    },
  });
  const section = buildCoverageSection(analysis, emptyScan());
  assert.equal(section.unresolvedCalls.length, 50);
  // highest counts kept first
  assert.equal(section.unresolvedCalls[0]?.count, 55);
  assert.equal(section.unresolvedCalls[49]?.count, 6);
});

test("buildCoverageSection sorts unresolvedCalls by count desc then bytewise", () => {
  const analysis = emptyAnalysis({
    graph: {
      nodes: [],
      edges: [],
      unresolvedCallCensus: [
        { callerQualifiedName: "src/b.ts#b", count: 3 },
        { callerQualifiedName: "src/a.ts#c", count: 3 },
        { callerQualifiedName: "src/a.ts#a", count: 5 },
      ],
    },
  });
  const section = buildCoverageSection(analysis, emptyScan());
  assert.deepEqual(
    section.unresolvedCalls.map((c) => c.callerQualifiedName),
    ["src/a.ts#a", "src/a.ts#c", "src/b.ts#b"],
  );
});

test("buildCoverageSection is deterministic across runs", () => {
  const analysis = emptyAnalysis({
    graph: {
      nodes: [],
      edges: [],
      unresolvedCallCensus: [
        { callerQualifiedName: "src/b.ts#b", count: 3 },
        { callerQualifiedName: "src/a.ts#a", count: 5 },
        { callerQualifiedName: "src/c.ts#c", count: 1 },
      ],
    },
  });
  const section1 = buildCoverageSection(analysis, emptyScan());
  const section2 = buildCoverageSection(analysis, emptyScan());
  assert.deepEqual(section1.unresolvedCalls, section2.unresolvedCalls);
});
