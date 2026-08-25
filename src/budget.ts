import { canonicalJson, digest } from "./json.js";
import type { ContextReport } from "./types.js";

export function finalize(report: Omit<ContextReport, "reportDigest">): ContextReport {
  return { ...report, reportDigest: digest(report) };
}

export function outputBytes(report: Omit<ContextReport, "reportDigest">): number {
  return Buffer.byteLength(canonicalJson(finalize(report)), "utf8") + 1;
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
): number {
  report.coverage.omittedFiles = available.files - report.files.length;
  report.coverage.omittedSymbols = available.symbols - report.symbols.length;
  report.coverage.omittedRelations = available.relations - report.relations.length;
  report.coverage.omittedSnippets = available.snippets - report.snippets.length;
  report.coverage.unresolvedRelations = available.unresolvedRelations;
  let bytes = outputBytes(report);
  while (report.budget.outputBytes !== bytes) {
    report.budget.outputBytes = bytes;
    bytes = outputBytes(report);
  }
  return bytes;
}
