import type { z } from "zod";
import type { graphSectionSchema, Sections } from "../contracts.js";
import { computeImpact } from "../graph/impact.js";
import { compareBytewise } from "../hash.js";
import type { SymbolFact } from "../model.js";
import { redact } from "../security.js";
import type { ScanResult } from "../snapshot.js";
import { isShimPath } from "../typescript-extractor.js";
import type { Analysis } from "./analysis.js";
import { computeDirImports } from "./dir-imports.js";
import { rankEntryPoints } from "./entries.js";
import { assignLayers } from "./layers.js";
import { scoreSymbolRisk } from "./risk.js";
import { buildTour } from "./tour.js";

type GraphSection = z.infer<typeof graphSectionSchema>;

export function buildGraphSection(analysis: Analysis, scan: ScanResult): GraphSection {
  let symbolCount = 0;
  const symbolFile = new Map<string, string>();
  for (const file of scan.fileFacts) {
    symbolCount += file.symbols.length;
    for (const sym of file.symbols) {
      symbolFile.set(sym.qualifiedName, file.path);
    }
  }

  const communities = analysis.communities.map((c) => {
    const fileCounts = new Map<string, number>();
    for (const member of c.members) {
      const path = symbolFile.get(member) ?? "<unknown>";
      fileCounts.set(path, (fileCounts.get(path) ?? 0) + 1);
    }
    const topFiles = [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1] || compareBytewise(a[0], b[0]))
      .slice(0, 5)
      .map(([path]) => redact(path));
    return {
      id: c.id,
      label: c.label,
      memberCount: c.memberCount,
      topFiles,
      cohesion: c.cohesion,
    };
  });

  const routes = scan.fileFacts
    .flatMap((file) =>
      file.routes.map((r) => ({
        id: `route:${file.path}#${r.method} ${r.path}`,
        method: r.method,
        path: redact(r.path),
        handler: r.handlerName ? redact(r.handlerName) : null,
      })),
    )
    .sort((a, b) => compareBytewise(a.id, b.id));

  const deadCode = analysis.deadCode.map((d) => ({
    qualifiedName: redact(d.qualifiedName),
    confidence: d.confidence,
  }));

  const surprises = analysis.surprises.map((s) => ({
    from: redact(s.from),
    to: redact(s.to),
    score: s.score,
    reasons: s.reasons,
  }));

  const questions = analysis.questions.map((q) => ({
    text: redact(q.text),
    nodeId: redact(q.nodeId),
  }));

  // outlines: up to 20 files (by total symbol count desc, then path), each with
  // up to 30 top-level symbols (exclude methods and constructors to avoid nested).
  const fileEntries = scan.fileFacts.map((file) => ({
    path: file.path,
    symbols: file.symbols,
  }));
  const topFiles = [...fileEntries]
    .sort((a, b) => {
      const ca = a.symbols.length;
      const cb = b.symbols.length;
      return cb - ca || compareBytewise(a.path, b.path);
    })
    .slice(0, 20);
  const outlines = topFiles
    .map((f) => {
      const topLevel = f.symbols
        .filter((s) => s.kind !== "method" && s.kind !== "constructor")
        .sort((a, b) => compareBytewise(a.qualifiedName, b.qualifiedName))
        .slice(0, 30)
        .map((s) => ({
          qualifiedName: redact(s.qualifiedName),
          kind: s.kind,
          exported: s.exported,
        }));
      return {
        path: redact(f.path),
        symbols: topLevel,
      };
    })
    .filter((o) => o.symbols.length > 0);

  // referenceCensus: symbols with incoming CALLS, cap 20, sorted by count desc then name.
  const incomingCalls = new Map<string, number>();
  for (const edge of analysis.graph.edges) {
    if (edge.kind === "CALLS" && edge.to.startsWith("sym:")) {
      const qname = edge.to.slice(4);
      incomingCalls.set(qname, (incomingCalls.get(qname) ?? 0) + 1);
    }
  }
  const referenceCensus = [...incomingCalls.entries()]
    .filter(([, count]) => count >= 1)
    .map(([qname, count]) => ({
      qualifiedName: redact(qname),
      incomingCalls: count,
    }))
    .sort(
      (a, b) =>
        b.incomingCalls - a.incomingCalls ||
        compareBytewise(a.qualifiedName, b.qualifiedName),
    )
    .slice(0, 20);

  const graphSection: GraphSection = {
    fileCount: scan.fileFacts.length,
    symbolCount,
    edgeCount: analysis.graph.edges.length,
    godSymbols: analysis.godSymbols
      .map((g) => ({
        qualifiedName: redact(g.qualifiedName),
        score: g.score,
      }))
      .slice(0, 20),
    boundaryFiles: analysis.boundaryFiles.map((p) => redact(p)),
  };

  if (communities.length > 0) {
    graphSection.communities = communities;
  }
  if (routes.length > 0) {
    graphSection.routes = routes;
  }
  if (deadCode.length > 0) {
    graphSection.deadCode = deadCode;
  }
  if (surprises.length > 0) {
    graphSection.surprises = surprises;
  }
  if (questions.length > 0) {
    graphSection.questions = questions;
  }
  if (outlines.length > 0) {
    graphSection.outlines = outlines;
  }
  if (referenceCensus.length > 0) {
    graphSection.referenceCensus = referenceCensus;
  }

  // WORK-7.2.1: deterministic layers partition the scanned paths.
  const layers = assignLayers(scan.fileFacts.map((f) => f.path));
  if (layers.length > 0) {
    graphSection.layers = layers;
  }

  // WORK-7.3.2: read-order tour from the top scored entry.
  const entry = rankEntryPoints(scan.fileFacts.map((f) => f.path))[0];
  if (entry !== undefined) {
    const tour = buildTour(analysis.graph, entry);
    if (tour.length > 0) {
      graphSection.tour = tour;
    }
  }

  // WORK-7.4.1: inter-directory IMPORTS matrix.
  const dirImports = computeDirImports(analysis.graph);
  if (dirImports.length > 0) {
    graphSection.dirImports = dirImports;
  }

  return graphSection;
}

function buildReviewSection(
  analysis: Analysis,
  scan: ScanResult,
  allSymbols: SymbolFact[],
) {
  const changedSymbols = [...analysis.changedSymbols].sort(compareBytewise);

  // risk
  const symbolById = new Map(allSymbols.map((s) => [s.qualifiedName, s]));
  const risk = changedSymbols
    .map((qname) => symbolById.get(qname))
    .filter((s): s is SymbolFact => s !== undefined)
    .map((s) => {
      const r = scoreSymbolRisk(
        s,
        analysis.graph,
        analysis.churn,
        analysis.maxChurn,
        analysis.maxInDegree,
      );
      return {
        qualifiedName: redact(r.qualifiedName),
        totalRisk: r.totalRisk,
        factors: r.factors.map((f) => ({
          factor: f.factor,
          raw: f.raw,
          capped: f.capped,
          contribution: f.contribution,
        })),
      };
    });

  // impact
  const seeds = changedSymbols.map((qname) => `sym:${qname}`);
  const impact = computeImpact(analysis.graph, seeds);
  const impactOut = {
    direct: impact.direct.map((e) => ({ id: redact(e.id), score: e.score })),
    transitive: impact.transitive.map((e) => ({ id: redact(e.id), score: e.score })),
  };

  // test gaps: files with symbols and no incoming TESTED_BY
  const testedFiles = new Set<string>();
  for (const edge of analysis.graph.edges) {
    if (edge.kind === "TESTED_BY" && edge.to.startsWith("file:")) {
      testedFiles.add(edge.to.slice(5));
    }
  }
  const testGaps: string[] = [];
  for (const file of scan.fileFacts) {
    if (
      file.symbols.length > 0 &&
      !isShimPath(file.path) &&
      !testedFiles.has(file.path)
    ) {
      testGaps.push(redact(file.path));
    }
  }
  testGaps.sort(compareBytewise);

  return {
    changedSymbols: changedSymbols.map((q) => redact(q)),
    risk,
    impact: impactOut,
    testGaps,
  };
}

export function buildCoverageSection(analysis: Analysis, scan: ScanResult) {
  const languagesSeen = [...new Set(scan.fileFacts.map((f) => f.language))].sort(
    compareBytewise,
  );

  const unresolvedCalls = analysis.graph.unresolvedCallCensus
    .map((c) => ({
      callerQualifiedName: redact(c.callerQualifiedName),
      count: c.count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        compareBytewise(a.callerQualifiedName, b.callerQualifiedName),
    )
    .slice(0, 50);

  const skipped = scan.skipped
    .filter((s) => s.reason !== "denylist")
    .map((s) => ({ path: redact(s.path), reason: redact(s.reason) }))
    .sort((a, b) => compareBytewise(a.path, b.path));

  return {
    unresolvedCalls,
    skipped,
    truncated: scan.truncated,
    languagesSeen,
    historyWindow: analysis.historyWindow,
  };
}

export function buildSections(
  focus: string[],
  scan: ScanResult,
  analysis: Analysis,
  allSymbols: SymbolFact[],
): Sections {
  const coverage = buildCoverageSection(analysis, scan);

  const sections: Sections = { coverage };

  if (focus.includes("graph")) {
    sections.graph = buildGraphSection(analysis, scan);
  }
  if (focus.includes("review")) {
    sections.review = buildReviewSection(analysis, scan, allSymbols);
  }

  return sections;
}
