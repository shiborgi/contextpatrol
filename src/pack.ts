import { analyze } from "./analysis/analysis.js";
import type { Capsule, PackRequest } from "./contracts.js";
import { analyzeWorkspace } from "./pipeline/analyze.js";
import { buildCandidates } from "./pipeline/candidates.js";
import { buildCapsule } from "./pipeline/emit.js";
import { normalize } from "./pipeline/normalize.js";
import { buildDenylist, filterAllowedPaths } from "./pipeline/policy.js";
import { verifyUnchanged } from "./pipeline/verify.js";

export interface PackOptions {
  extraDenylist?: readonly string[];
  /** Test-only hook invoked after scanning but before source-change
   * verification; never set in production. */
  onAfterScan?: () => void | Promise<void>;
}

export async function pack(
  request: PackRequest,
  options: PackOptions = {},
): Promise<Capsule> {
  const normalized = normalize(request);
  const extraDeny = [
    ...(options.extraDenylist ?? []),
    ...(normalized.excludePaths ?? []),
  ];
  const denylist = buildDenylist(extraDeny);

  // Drop changed paths that the policy would deny.
  const changedPaths = filterAllowedPaths(normalized.changedPaths, denylist);

  const { identity, scan, snapshot } = await analyzeWorkspace(
    normalized.workspace,
    denylist,
    normalized.gitRef,
    normalized.includePaths,
  );

  const analysis = analyze(scan, identity.root, denylist, changedPaths);

  const candidates = buildCandidates(
    normalized.focus,
    scan,
    normalized.intent,
    analysis,
  );

  if (options.onAfterScan) {
    await options.onAfterScan();
  }

  await verifyUnchanged(
    identity,
    denylist,
    scan,
    normalized.gitRef,
    snapshot.head,
    normalized.includePaths,
  );

  return buildCapsule({
    identity,
    snapshot,
    scan,
    candidates,
    analysis,
    focus: normalized.focus,
    intent: normalized.intent,
    tokenBudget: normalized.tokenBudget,
    changedPaths,
    gitRef: normalized.gitRef,
    includePaths: normalized.includePaths,
    excludePaths: normalized.excludePaths,
  });
}
