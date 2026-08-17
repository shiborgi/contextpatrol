import { estimateTokens } from "../budget.js";
import type { Focus } from "../constants.js";
import type { Evidence } from "../contracts.js";
import { compareBytewise } from "../hash.js";
import type { SymbolFact } from "../model.js";
import { redact } from "../security.js";
import type { ScanResult } from "../snapshot.js";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "be",
  "it",
  "this",
  "that",
  "which",
  "as",
  "at",
  "by",
  "from",
  "into",
  "about",
  "over",
  "under",
  "do",
  "does",
  "did",
]);

export interface Candidate {
  evidence: Evidence;
  clipable: boolean;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term));
}

function symbolScore(
  symbol: SymbolFact,
  terms: string[],
  changedPaths: string[],
): number {
  const name = symbol.name.toLowerCase();
  const qualified = symbol.qualifiedName.toLowerCase();
  const path = symbol.path.toLowerCase();
  const context = `${symbol.signature} ${symbol.jsdoc}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name.includes(term)) {
      score += 3;
    }
    if (qualified.includes(term)) {
      score += 2;
    }
    if (path.includes(term)) {
      score += 2;
    }
    if (context.includes(term)) {
      score += 1;
    }
  }
  if (symbol.exported) {
    score += 1;
  }
  for (const cp of changedPaths) {
    const lower = cp.toLowerCase();
    if (path === lower || path.startsWith(`${lower}/`)) {
      score += 10;
      break;
    }
  }
  return score;
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
    .map(([dir, count]) => `${dir} (${count})`)
    .join(", ");

  const text = [
    `Files: ${fileFacts.length} (${languages || "none"})`,
    `Symbols: ${symbolCount}`,
    `Top-level: ${dirs || "none"}`,
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
  changedPaths: string[],
): Candidate[] {
  const allSymbols: SymbolFact[] = [];
  for (const file of scan.fileFacts) {
    for (const symbol of file.symbols) {
      allSymbols.push(symbol);
    }
  }

  const terms = tokenize(intent);
  const ranked = allSymbols
    .map((symbol) => ({ symbol, score: symbolScore(symbol, terms, changedPaths) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        compareBytewise(a.symbol.qualifiedName, b.symbol.qualifiedName),
    );

  const candidates: Candidate[] = [];
  if (focus.includes("architecture")) {
    candidates.push({
      evidence: buildArchitectureEvidence(scan.fileFacts),
      clipable: false,
    });
  }

  if (focus.includes("symbols")) {
    for (const { symbol } of ranked.slice(0, 500)) {
      candidates.push({ evidence: symbolEvidence(symbol), clipable: false });
    }
  }

  if (focus.includes("source")) {
    for (const { symbol } of ranked.slice(0, 200)) {
      candidates.push({ evidence: sourceEvidence(symbol), clipable: true });
    }
  }

  return candidates;
}
