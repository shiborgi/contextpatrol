import type { Analysis } from "../analysis/analysis.js";
import { buildSections } from "../analysis/sections.js";
import { clipText, estimateTokens, packBudget } from "../budget.js";
import {
  ESTIMATOR,
  type Focus,
  LIMITS,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
} from "../constants.js";
import type { Capsule, Evidence, Sections, Snapshot } from "../contracts.js";
import type { WorkspaceIdentity } from "../git-workspace.js";
import { canonicalJson, digestOf } from "../hash.js";
import type { ScanResult } from "../snapshot.js";
import type { Candidate } from "./candidates.js";

// Optional graph insight fields, dropped in this fixed order when the emitted
// sections would exceed the remaining budget. Required graph counts and the
// coverage section are never dropped.
const OPTIONAL_INSIGHT_DROP_ORDER = [
  "questions",
  "surprises",
  "deadCode",
  "routes",
  "communities",
] as const;

export function fitOptionalInsights(sections: Sections, remaining: number): Sections {
  let result = sections;
  while (result.graph && estimateTokens(canonicalJson(result)) > remaining) {
    const graph = result.graph;
    const key = OPTIONAL_INSIGHT_DROP_ORDER.find((k) => k in graph);
    if (!key) {
      break;
    }
    const nextGraph = { ...graph };
    delete nextGraph[key];
    result = { ...result, graph: nextGraph };
  }
  return result;
}

export interface EmitInput {
  identity: WorkspaceIdentity;
  snapshot: Snapshot;
  scan: ScanResult;
  candidates: Candidate[];
  analysis: Analysis;
  focus: Focus[];
  intent: string;
  tokenBudget: number;
  changedPaths: string[];
  gitRef?: string;
  includePaths?: string[];
  excludePaths?: string[];
}

export function buildCapsule(input: EmitInput): Capsule {
  const { identity, snapshot, scan, candidates, analysis, focus, intent, tokenBudget } =
    input;
  const changedPaths = input.changedPaths;
  const gitRef = input.gitRef;
  const includePaths = input.includePaths;
  const excludePaths = input.excludePaths;

  const packed = packBudget(
    candidates.map((c) => ({
      id: c.evidence.id,
      estimatedTokens: c.evidence.estimatedTokens,
      clipable: c.clipable,
    })),
    tokenBudget,
  );

  const candidateById = new Map(candidates.map((c) => [c.evidence.id, c]));
  const evidence: Evidence[] = [];
  for (const item of packed.included) {
    const candidate = candidateById.get(item.id);
    if (!candidate) {
      continue;
    }
    let ev = candidate.evidence;
    if (item.clipped) {
      const text = clipText(ev.text, item.estimatedTokens);
      ev = {
        ...ev,
        text,
        clipped: true,
        estimatedTokens: estimateTokens(text),
      };
    }
    evidence.push(ev);
  }

  const omitted = packed.omitted.map((o) => ({ ...o }));
  if (omitted.length > 50) {
    const extra = omitted.length - 50;
    omitted.length = 50;
    omitted.push({ id: `...${extra} more`, reason: "token-budget" });
  }

  const warnings: string[] = [];
  const denied = scan.skipped.filter((s) => s.reason === "denylist").length;
  if (denied > 0) {
    warnings.push(`${denied} file(s) excluded by denylist`);
  }
  const tooLarge = scan.skipped.filter(
    (s) => s.reason === "too-large" || s.reason === "binary",
  );
  if (tooLarge.length > 0) {
    warnings.push(`${tooLarge.length} file(s) skipped (too-large or binary)`);
  }
  if (scan.truncated) {
    warnings.push(
      `workspace exceeds maxFiles (${LIMITS.maxFiles}); snapshot is partial`,
    );
  }

  const requestDigest = digestOf({
    protocolVersion: PROTOCOL_VERSION,
    workspace: identity.workspaceId,
    intent,
    focus,
    tokenBudget,
    changedPaths,
    ...(gitRef !== undefined ? { gitRef } : {}),
    ...(includePaths !== undefined ? { includePaths } : {}),
    ...(excludePaths !== undefined ? { excludePaths } : {}),
  });

  const capsuleId = `ctx-${digestOf({ requestDigest, snapshotDigest: snapshot.snapshotDigest }).slice(0, 16)}`;

  const allSymbols = scan.fileFacts.flatMap((f) => f.symbols);
  const rawSections = buildSections(focus, scan, analysis, allSymbols);

  const evidenceTokens = evidence.reduce((sum, ev) => sum + ev.estimatedTokens, 0);
  const remaining = tokenBudget - evidenceTokens;
  const sections = fitOptionalInsights(rawSections, remaining);
  const sectionTokens = estimateTokens(canonicalJson(sections));
  const estimatedTokens = evidenceTokens + sectionTokens;

  const body: Omit<Capsule, "capsuleDigest"> = {
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capsuleId,
    requestDigest,
    intent,
    focus,
    snapshot,
    budget: {
      requestedTokens: tokenBudget,
      estimatedTokens,
      estimator: ESTIMATOR,
    },
    changedPaths,
    evidence,
    sections,
    omitted,
    warnings,
  };

  return {
    ...body,
    capsuleDigest: digestOf(body),
  };
}
