import { analyze } from "./analysis/analysis.js";
import type { Capsule, PackRequest } from "./contracts.js";
import { resolveRef, resolveWorkspace, runGit } from "./git-workspace.js";
import { compareBytewise } from "./hash.js";
import { analyzeWorkspace } from "./pipeline/analyze.js";
import { buildCandidates } from "./pipeline/candidates.js";
import { buildCapsule } from "./pipeline/emit.js";
import { normalize } from "./pipeline/normalize.js";
import { loadProjectOverlay } from "./pipeline/overlay.js";
import { buildDenylist, filterAllowedPaths } from "./pipeline/policy.js";
import { verifyUnchanged } from "./pipeline/verify.js";
import { canonicalizePath } from "./security.js";

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

  // WAVE-6.4: load read-only project overlay and merge (request wins)
  const identityForOverlay = resolveWorkspace(normalized.workspace);
  const overlay = loadProjectOverlay(identityForOverlay.root);

  let finalIncludePaths = normalized.includePaths;
  if (!finalIncludePaths || finalIncludePaths.length === 0) {
    if (overlay?.includePaths && overlay.includePaths.length > 0) {
      finalIncludePaths = overlay.includePaths;
    }
  }

  let finalExcludePaths = normalized.excludePaths;
  if (!finalExcludePaths || finalExcludePaths.length === 0) {
    if (overlay?.excludePaths && overlay.excludePaths.length > 0) {
      finalExcludePaths = overlay.excludePaths;
    }
  }

  const extraDeny = [...(options.extraDenylist ?? []), ...(finalExcludePaths ?? [])];
  const denylist = buildDenylist(extraDeny);

  const effectiveIncludePaths = finalIncludePaths;
  const effectiveExcludePaths = finalExcludePaths;

  const { identity, scan, snapshot } = await analyzeWorkspace(
    normalized.workspace,
    denylist,
    normalized.gitRef,
    effectiveIncludePaths,
  );

  // baseRef handling (WAVE-5.3):
  // - always resolve if present (to fail closed with REQUEST_INVALID)
  // - if no explicit changedPaths, compute three-dot name-only as the changed set
  // - pass range to mapDiff only when the set was driven by baseRef (so symbols match delta)
  let resolvedBase: string | undefined;
  let resolvedHead: string | undefined;
  let effectiveChangedPaths = normalized.changedPaths;
  if (normalized.baseRef !== undefined) {
    resolvedBase = resolveRef(identity.root, normalized.baseRef);
    resolvedHead = snapshot.head;
    if (normalized.changedPaths.length === 0) {
      let diffNames = "";
      try {
        diffNames = runGit(
          ["diff", "--name-only", `${resolvedBase}...${resolvedHead}`],
          identity.root,
        ).toString("utf8");
      } catch {
        diffNames = "";
      }
      const names = diffNames
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const canonicals: string[] = [];
      for (const raw of names) {
        const canonical = canonicalizePath(raw);
        if (canonical !== null && !canonicals.includes(canonical)) {
          canonicals.push(canonical);
        }
      }
      canonicals.sort(compareBytewise);
      effectiveChangedPaths = canonicals;
    }
  }

  // Drop changed paths that the policy would deny.
  const changedPaths = filterAllowedPaths(effectiveChangedPaths, denylist);

  const diffRange =
    resolvedBase && resolvedHead && normalized.changedPaths.length === 0
      ? { left: resolvedBase, right: resolvedHead }
      : undefined;
  const analysis = analyze(scan, identity.root, denylist, changedPaths, diffRange);

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
    effectiveIncludePaths,
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
    baseRef: normalized.baseRef,
    includePaths: effectiveIncludePaths,
    excludePaths: effectiveExcludePaths,
  });
}
