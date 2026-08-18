import type { z } from "zod";
import type { graphSectionSchema, Sections } from "../contracts.js";
import { computeImpact } from "../graph/impact.js";
import { compareBytewise } from "../hash.js";
import type { SymbolFact } from "../model.js";
import { redact } from "../security.js";
import type { ScanResult } from "../snapshot.js";
import type { Analysis } from "./analysis.js";
import { scoreSymbolRisk } from "./risk.js";

type GraphSection = z.infer<typeof graphSectionSchema>;

function buildGraphSection(analysis: Analysis, scan: ScanResult): GraphSection {
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
      memberCount: c.memberCount,
      topFiles,
      cohesion: c.cohesion,
    };
  });

  const graphSection: GraphSection = {
    fileCount: scan.fileFacts.length,
    symbolCount,
    edgeCount: analysis.graph.edges.length,
    godSymbols: analysis.godSymbols.map((g) => ({
      qualifiedName: redact(g.qualifiedName),
      score: g.score,
    })),
    boundaryFiles: analysis.boundaryFiles.map((p) => redact(p)),
  };

  if (communities.length > 0) {
    graphSection.communities = communities;
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
    if (file.symbols.length > 0 && !testedFiles.has(file.path)) {
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

function buildCoverageSection(analysis: Analysis, scan: ScanResult) {
  const languagesSeen = [...new Set(scan.fileFacts.map((f) => f.language))].sort(
    compareBytewise,
  );

  const unresolvedCalls = analysis.graph.unresolvedCallCensus
    .map((c) => ({
      callerQualifiedName: redact(c.callerQualifiedName),
      count: c.count,
    }))
    .sort((a, b) => compareBytewise(a.callerQualifiedName, b.callerQualifiedName));

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
