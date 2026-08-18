import type { Analysis } from "../analysis/analysis.js";
import { estimateTokens } from "../budget.js";
import type { Focus } from "../constants.js";
import type { Evidence } from "../contracts.js";
import { compareBytewise } from "../hash.js";
import type { SymbolFact } from "../model.js";
import { rankSymbols } from "../ranking.js";
import { redact } from "../security.js";
import type { ScanResult } from "../snapshot.js";

export interface Candidate {
  evidence: Evidence;
  clipable: boolean;
}

function symbolId(symbol: SymbolFact, kind: "sym" | "src"): string {
  return `${kind}:${symbol.qualifiedName}#L${symbol.range.startLine}-${symbol.range.endLine}`;
}

function buildArchitectureEvidence(
  fileFacts: { path: string; language: string; symbols: SymbolFact[] }[],
): Evidence {
  const byLanguage = new Map<string, number>();
  const byDir = new Map<string, number>();
  let symbolCount = 0;
  const entryPoints: string[] = [];

  for (const file of fileFacts) {
    byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + 1);
    const dir = file.path.includes("/") ? (file.path.split("/")[0] ?? ".") : ".";
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    symbolCount += file.symbols.length;
    if (/^(src\/)?index\.(ts|js|tsx|jsx)$/i.test(file.path)) {
      entryPoints.push(file.path);
    }
  }

  const languages = [...byLanguage.entries()]
    .sort((a, b) => compareBytewise(a[0], b[0]))
    .map(([lang, count]) => `${lang}: ${count}`)
    .join(", ");
  const dirs = [...byDir.entries()]
    .sort((a, b) => compareBytewise(a[0], b[0]))
    .map(([dir, count]) => `${dir}: ${count}`)
    .join(", ");

  const text = [
    `Files: ${fileFacts.length} (${languages || "none"})`,
    `Symbols: ${symbolCount}`,
    `Directories: ${dirs || "none"}`,
    entryPoints.length > 0 ? `Entry points: ${entryPoints.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: "arch:repository",
    kind: "architecture",
    title: "Repository architecture",
    text,
    provenance: "heuristic",
    confidence: 0.7,
    estimatedTokens: estimateTokens(text),
  };
}

function symbolEvidence(symbol: SymbolFact): Evidence {
  const parts = [symbol.signature];
  if (symbol.jsdoc) {
    parts.push(symbol.jsdoc);
  }
  const text = redact(parts.join("\n"));
  return {
    id: symbolId(symbol, "sym"),
    kind: "symbol",
    title: symbol.name,
    text,
    path: symbol.path,
    range: symbol.range,
    provenance: "extracted",
    confidence: symbol.confidence,
    estimatedTokens: estimateTokens(text),
  };
}

function sourceEvidence(symbol: SymbolFact): Evidence {
  const text = redact(symbol.source);
  return {
    id: symbolId(symbol, "src"),
    kind: "source",
    title: symbol.name,
    text,
    path: symbol.path,
    range: symbol.range,
    provenance: "extracted",
    confidence: symbol.confidence,
    estimatedTokens: estimateTokens(text),
  };
}

export function buildCandidates(
  focus: Focus[],
  scan: ScanResult,
  intent: string,
  analysis: Analysis,
): Candidate[] {
  const allSymbols: SymbolFact[] = [];
  for (const file of scan.fileFacts) {
    for (const symbol of file.symbols) {
      allSymbols.push(symbol);
    }
  }

  const ranked = rankSymbols(
    allSymbols,
    intent,
    analysis.graph,
    analysis.changedSymbols,
    analysis.godSymbols,
  );

  const candidates: Candidate[] = [];
  if (focus.includes("architecture")) {
    candidates.push({
      evidence: buildArchitectureEvidence(scan.fileFacts),
      clipable: false,
    });
  }

  if (focus.includes("symbols")) {
    for (const symbol of ranked.slice(0, 500)) {
      candidates.push({ evidence: symbolEvidence(symbol), clipable: false });
    }
  }

  if (focus.includes("source")) {
    for (const symbol of ranked.slice(0, 200)) {
      candidates.push({ evidence: sourceEvidence(symbol), clipable: true });
    }
  }

  return candidates;
}
