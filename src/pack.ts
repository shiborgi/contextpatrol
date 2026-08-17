import type { Capsule, PackRequest } from "./contracts.js";
import { analyzeWorkspace } from "./pipeline/analyze.js";
import { buildCandidates } from "./pipeline/candidates.js";
import { buildCapsule } from "./pipeline/emit.js";
import { normalize } from "./pipeline/normalize.js";
import { buildDenylist, filterAllowedPaths } from "./pipeline/policy.js";
import { verifyUnchanged } from "./pipeline/verify.js";

export interface PackOptions {
  extraDenylist?: readonly string[];
}

export async function pack(
  request: PackRequest,
  options: PackOptions = {},
): Promise<Capsule> {
  const normalized = normalize(request);
  const denylist = buildDenylist(options.extraDenylist);

  // Drop changed paths that the policy would deny.
  const changedPaths = filterAllowedPaths(normalized.changedPaths, denylist);

  const { identity, scan, snapshot } = await analyzeWorkspace(
    normalized.workspace,
    denylist,
  );

  const candidates = buildCandidates(
    normalized.focus,
    scan,
    normalized.intent,
    changedPaths,
  );

  await verifyUnchanged(identity, denylist, scan);

  return buildCapsule({
    identity,
    snapshot,
    scan,
    candidates,
    focus: normalized.focus,
    intent: normalized.intent,
    tokenBudget: normalized.tokenBudget,
    changedPaths,
  });
}
