import type { Analysis } from "../analysis/analysis.js";
import { computeDirImports } from "../analysis/dir-imports.js";
import { rankEntryPoints } from "../analysis/entries.js";
import { assignLayers } from "../analysis/layers.js";
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

function symbolId(symbol: SymbolFact, kind: "sym" | "source"): string {
  return `${kind}:${symbol.qualifiedName}#L${symbol.range.startLine}-${symbol.range.endLine}`;
}

function buildArchitectureEvidence(
  scan: ScanResult,
  analysis: Analysis,
  focus: Focus[],
): Evidence {
  const fileFacts = scan.fileFacts;
  const byLanguage = new Map<string, number>();
  const byDir = new Map<string, number>();
  let symbolCount = 0;

  for (const file of fileFacts) {
    byLanguage.set(file.language, (byLanguage.get(file.language) ?? 0) + 1);
    const dir = file.path.includes("/") ? (file.path.split("/")[0] ?? ".") : ".";
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    symbolCount += file.symbols.length;
  }

  const entryPoints = rankEntryPoints(fileFacts.map((f) => f.path)).slice(0, 5);

  const languages = [...byLanguage.entries()]
    .sort((a, b) => compareBytewise(a[0], b[0]))
    .map(([lang, count]) => `${lang}: ${count}`)
    .join(", ");
  const dirs = [...byDir.entries()]
    .sort((a, b) => compareBytewise(a[0], b[0]))
    .map(([dir, count]) => `${dir}: ${count}`)
    .join(", ");

  const godNames = analysis.godSymbols.slice(0, 5).map((g) => g.qualifiedName);
  const boundaryNames = analysis.boundaryFiles.slice(0, 5);

  // communities with first topFile (member count desc, then path bytewise)
  let communitiesLine = "";
  if (analysis.communities.length > 0) {
    // build symbol to path map
    const symbolToPath = new Map<string, string>();
    for (const f of fileFacts) {
      for (const s of f.symbols) {
        symbolToPath.set(s.qualifiedName, f.path);
      }
    }
    const comms = analysis.communities
      .map((c) => {
        const fileCounts = new Map<string, number>();
        for (const m of c.members) {
          const p = symbolToPath.get(m) ?? "<unknown>";
          fileCounts.set(p, (fileCounts.get(p) ?? 0) + 1);
        }
        const top =
          [...fileCounts.entries()]
            .sort((a, b) => b[1] - a[1] || compareBytewise(a[0], b[0]))
            .slice(0, 1)
            .map(([p]) => redact(p))[0] || "";
        return `${c.label || c.id}${top ? ":" + redact(top) : ""}`;
      })
      .slice(0, 5)
      .join(", ");
    communitiesLine = `Communities: ${analysis.communities.length} (${comms})`;
  }

  // scripts from root package.json (already parsed at scan time)
  const scriptsLine =
    scan.scriptNames && scan.scriptNames.length > 0
      ? `Scripts: ${scan.scriptNames.join(", ")}`
      : "";

  // outline hubs: top 5 files by symbol count (same as outlines ranking)
  let outlineHubsLine = "";
  if (fileFacts.some((f) => f.symbols.length > 0)) {
    const ranked = [...fileFacts]
      .sort((a, b) => {
        const ca = a.symbols.length;
        const cb = b.symbols.length;
        return cb - ca || compareBytewise(a.path, b.path);
      })
      .slice(0, 5)
      .map((f) => redact(f.path));
    if (ranked.length > 0) {
      outlineHubsLine = `Outline hubs: ${ranked.join(", ")}`;
    }
  }

  const text = [
    `Files: ${fileFacts.length} (${languages || "none"})`,
    `Symbols: ${symbolCount}`,
    `Directories: ${dirs || "none"}`,
    entryPoints.length > 0 ? `Entry points: ${entryPoints.join(", ")}` : "",
    godNames.length > 0 ? `God symbols: ${godNames.join(", ")}` : "",
    communitiesLine,
    boundaryNames.length > 0 ? `Boundary files: ${boundaryNames.join(", ")}` : "",
    scriptsLine,
    outlineHubsLine,
    ...(focus.includes("graph")
      ? [`Layers: ${layerSummary(scan.fileFacts.map((f) => f.path))}`]
      : []),
    ...(focus.includes("graph") ? dirImportsText(analysis) : []),
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

function layerSummary(filePaths: string[]): string {
  return assignLayers(filePaths)
    .map((l) => `${l.id}:${l.nodeIds.length}`)
    .join(", ");
}

function dirImportsText(analysis: Analysis): string[] {
  const dirs = computeDirImports(analysis.graph).slice(0, 8);
  if (dirs.length === 0) {
    return [];
  }
  return [
    `Dir imports: ${dirs.map((d) => `${d.from}->${d.to}:${d.count}`).join(", ")}`,
  ];
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
    id: symbolId(symbol, "source"),
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
      evidence: buildArchitectureEvidence(scan, analysis, focus),
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
