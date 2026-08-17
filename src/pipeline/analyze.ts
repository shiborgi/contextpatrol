import { LIMITS } from "../constants.js";
import type { Snapshot } from "../contracts.js";
import { resolveWorkspace, type WorkspaceIdentity } from "../git-workspace.js";
import { finalizeSnapshot, type ScanResult, scanWorkspace } from "../snapshot.js";

export interface Analysis {
  identity: WorkspaceIdentity;
  scan: ScanResult;
  snapshot: Snapshot;
}

export async function analyzeWorkspace(
  workspace: string,
  denylist: readonly string[],
): Promise<Analysis> {
  const identity = resolveWorkspace(workspace);
  const scan = await scanWorkspace(identity, denylist, LIMITS.maxFiles);
  const { snapshot } = finalizeSnapshot(scan, identity);
  return { identity, scan, snapshot };
}
