import { canonicalJson, digest } from "./json.js";
import type { ContextReport } from "./types.js";

const SECTION_DIGEST_DOMAIN = "contextpatrol.section-digest.v1";

export interface BudgetOptions {
  includeSectionDigests?: boolean;
}

function sectionDigest(section: string, value: unknown): string {
  return digest({
    domain: SECTION_DIGEST_DOMAIN,
    schemaVersion: 1,
    section,
    value,
  });
}

function computeSectionDigests(
  report: Omit<ContextReport, "reportDigest">,
): NonNullable<ContextReport["sectionDigests"]> {
  return {
    changes: sectionDigest("changes", report.changes),
    coverage: sectionDigest("coverage", report.coverage),
    files: sectionDigest("files", report.files),
    relations: sectionDigest("relations", report.relations),
    snippets: sectionDigest("snippets", report.snippets),
    symbols: sectionDigest("symbols", report.symbols),
    tests: sectionDigest("tests", report.tests),
  };
}

function attachSectionDigests(
  report: Omit<ContextReport, "reportDigest">,
  include: boolean | undefined,
): Omit<ContextReport, "reportDigest"> {
  if (!include) return report;
  return { ...report, sectionDigests: computeSectionDigests(report) };
}

export function finalize(
  report: Omit<ContextReport, "reportDigest">,
  options: BudgetOptions = {},
): ContextReport {
  const withDigests = attachSectionDigests(report, options.includeSectionDigests);
  return { ...withDigests, reportDigest: digest(withDigests) };
}

export function outputBytes(
  report: Omit<ContextReport, "reportDigest">,
  options: BudgetOptions = {},
): number {
  return Buffer.byteLength(canonicalJson(finalize(report, options)), "utf8") + 1;
}

export function refreshBudget(
  report: Omit<ContextReport, "reportDigest">,
  available: {
    files: number;
    symbols: number;
    relations: number;
    snippets: number;
    changes: number;
    testFiles: number;
    testGaps: number;
    unresolvedRelations: number;
  },
  options: BudgetOptions = {},
): number {
  report.coverage.omittedFiles = available.files - report.files.length;
  report.coverage.omittedSymbols = available.symbols - report.symbols.length;
  report.coverage.omittedRelations = available.relations - report.relations.length;
  report.coverage.omittedSnippets = available.snippets - report.snippets.length;
  report.coverage.unresolvedRelations = available.unresolvedRelations;
  let bytes = outputBytes(report, options);
  while (report.budget.outputBytes !== bytes) {
    report.budget.outputBytes = bytes;
    bytes = outputBytes(report, options);
  }
  return bytes;
}
