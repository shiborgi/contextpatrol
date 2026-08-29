import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { finalize, outputBytes, refreshBudget } from "../src/budget.js";
import type { ContextReport } from "../src/types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) =>
          Buffer.compare(Buffer.from(left), Buffer.from(right)),
        )
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function sectionDigest(section: string, value: unknown): string {
  return sha256({
    domain: "contextpatrol.section-digest.v1",
    schemaVersion: 1,
    section,
    value,
  });
}

function baseReport(): Omit<ContextReport, "reportDigest"> {
  return {
    schemaVersion: 1,
    provider: { name: "contextpatrol", version: "1.0.0" },
    requestDigest:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    target: {
      kind: "working-tree",
      commit: "0000000000000000000000000000000000000000",
      dirtyDigest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      contentDigest:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
    budget: { maxOutputBytes: 4096, outputBytes: 0, limited: false },
    summary: { query: "token", filesConsidered: 1, filesSelected: 1 },
    files: [{ path: "a.ts", score: 1, language: "ts", lines: 1 }],
    symbols: [],
    relations: [],
    changes: [],
    tests: { files: [], changedSourceWithoutTest: [] },
    snippets: [],
    coverage: {
      eligibleFiles: 1,
      analyzedFiles: 1,
      skippedBinary: 0,
      skippedOversized: 0,
      omittedFiles: 0,
      omittedSymbols: 0,
      omittedRelations: 0,
      omittedSnippets: 0,
      unresolvedRelations: 0,
    },
  };
}

test("section digests are omitted unless opted in", () => {
  const plain = finalize(baseReport());
  assert.equal(plain.sectionDigests, undefined);
  assert.equal(
    finalize(baseReport(), { includeSectionDigests: false }).sectionDigests,
    undefined,
  );
  const opted = finalize(baseReport(), { includeSectionDigests: true });
  assert.deepEqual(Object.keys(opted.sectionDigests ?? {}).sort(), [
    "changes",
    "coverage",
    "files",
    "relations",
    "snippets",
    "symbols",
    "tests",
  ]);
});

test("each section digest is the independent sha256 of its canonical preimage", () => {
  const report = baseReport();
  const opted = finalize(report, { includeSectionDigests: true });
  assert.ok(opted.sectionDigests);
  const expected: Record<keyof NonNullable<ContextReport["sectionDigests"]>, string> = {
    changes: sectionDigest("changes", report.changes),
    coverage: sectionDigest("coverage", report.coverage),
    files: sectionDigest("files", report.files),
    relations: sectionDigest("relations", report.relations),
    snippets: sectionDigest("snippets", report.snippets),
    symbols: sectionDigest("symbols", report.symbols),
    tests: sectionDigest("tests", report.tests),
  };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    assert.equal(opted.sectionDigests[key], expected[key]);
  }
});

test("section digests exclude sectionDigests and reportDigest", () => {
  const report = baseReport();
  const opted = finalize(report, { includeSectionDigests: true });
  assert.ok(opted.sectionDigests);
  const recomputed = {
    changes: sectionDigest("changes", report.changes),
    coverage: sectionDigest("coverage", report.coverage),
    files: sectionDigest("files", report.files),
    relations: sectionDigest("relations", report.relations),
    snippets: sectionDigest("snippets", report.snippets),
    symbols: sectionDigest("symbols", report.symbols),
    tests: sectionDigest("tests", report.tests),
  };
  assert.deepEqual(opted.sectionDigests, recomputed);
  assert.notEqual(opted.reportDigest, opted.sectionDigests.files);
});

test("reportDigest hashes the complete finalized report except itself", () => {
  const report = baseReport();
  const opted = finalize(report, { includeSectionDigests: true });
  const withoutReportDigest = {
    ...opted,
    reportDigest: undefined as unknown as string,
  };
  assert.equal(opted.reportDigest, sha256(withoutReportDigest));
});

test("outputBytes accounts for a trailing newline", () => {
  const opted = finalize(baseReport(), { includeSectionDigests: true });
  const json = canonicalJson(opted);
  assert.equal(
    Buffer.byteLength(json, "utf8") + 1,
    outputBytes(baseReport(), { includeSectionDigests: true }),
  );
});

test("refreshBudget reaches a fixed point with section digests included", () => {
  const report = baseReport();
  const available = {
    files: report.files.length,
    symbols: 0,
    relations: 0,
    snippets: 0,
    changes: 0,
    testFiles: 0,
    testGaps: 0,
    unresolvedRelations: 0,
  };
  const bytes = refreshBudget(report, available, { includeSectionDigests: true });
  assert.equal(report.budget.outputBytes, bytes);
  assert.equal(
    report.budget.outputBytes,
    outputBytes(report, { includeSectionDigests: true }),
  );
});
