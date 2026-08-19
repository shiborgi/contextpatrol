import { LIMITS } from "../constants.js";
import type { Snapshot } from "../contracts.js";
import {
  resolveRef,
  resolveWorkspace,
  type WorkspaceIdentity,
} from "../git-workspace.js";
import { finalizeSnapshot, type ScanResult, scanWorkspace } from "../snapshot.js";

export interface Analysis {
  identity: WorkspaceIdentity;
  scan: ScanResult;
  snapshot: Snapshot;
}

export async function analyzeWorkspace(
  workspace: string,
  denylist: readonly string[],
  gitRef?: string,
  includePaths?: string[],
): Promise<Analysis> {
  const identity = resolveWorkspace(workspace);
  const commitSha =
    gitRef !== undefined ? resolveRef(identity.root, gitRef) : undefined;
  const scan = await scanWorkspace(
    identity,
    denylist,
    LIMITS.maxFiles,
    commitSha,
    includePaths,
  );
  const { snapshot } = finalizeSnapshot(scan, identity, commitSha);
  return { identity, scan, snapshot };
}
