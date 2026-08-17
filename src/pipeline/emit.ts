import { clipText, estimateTokens, packBudget } from "../budget.js";
import {
  ESTIMATOR,
  type Focus,
  LIMITS,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
} from "../constants.js";
import type { Capsule, Evidence, Snapshot } from "../contracts.js";
import type { WorkspaceIdentity } from "../git-workspace.js";
import { digestOf } from "../hash.js";
import type { ScanResult } from "../snapshot.js";
import type { Candidate } from "./candidates.js";

export interface EmitInput {
  identity: WorkspaceIdentity;
  snapshot: Snapshot;
  scan: ScanResult;
  candidates: Candidate[];
  focus: Focus[];
  intent: string;
  tokenBudget: number;
  changedPaths: string[];
}

export function buildCapsule(input: EmitInput): Capsule {
  const { identity, snapshot, scan, candidates, focus, intent, tokenBudget } = input;
  const changedPaths = input.changedPaths;

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
  });

  const capsuleId = `ctx-${digestOf({ requestDigest, snapshotDigest: snapshot.snapshotDigest }).slice(0, 16)}`;
  const estimatedTokens = evidence.reduce((sum, ev) => sum + ev.estimatedTokens, 0);

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
    omitted,
    warnings,
  };

  return {
    ...body,
    capsuleDigest: digestOf(body),
  };
}
