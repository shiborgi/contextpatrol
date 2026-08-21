import { readFileSync } from "node:fs";
import { blobSize, readBlob, type WorkspaceIdentity } from "./git-workspace.js";
import { compareBytewise, digestOf, digestOfBytes } from "./hash.js";
import type { ProjectOverlay } from "./pipeline/overlay.js";
import type { ScanResult } from "./snapshot.js";

export interface AnalysisTarget {
  version: 1;
  head: string;
  base?: string;
  diffRange?: { left: string; right: string };
  includePaths?: string[];
  excludePaths?: string[];
  sourceTreeDigest: string;
  dirtyBlobs: Array<{ path: string; digest: string }>;
  policyDigest: string;
  packageDigest: string | null;
  typescriptConfigDigest: string | null;
  overlay: {
    path: string;
    digest: string;
    descriptor: ProjectOverlay;
  } | null;
  historyEndpoint: string;
  truncated: boolean;
  manifestDigest: string;
}

function blobDigest(
  identity: WorkspaceIdentity,
  commit: string | undefined,
  path: string,
): string | null {
  try {
    if (commit !== undefined) {
      const size = blobSize(identity.root, commit, path);
      if (size > 1_000_000) return null;
      return digestOfBytes(readBlob(identity.root, commit, path));
    }
    return digestOfBytes(readFileSync(`${identity.root}/${path}`));
  } catch {
    return null;
  }
}

export function buildAnalysisTarget(input: {
  identity: WorkspaceIdentity;
  scan: ScanResult;
  commit?: string;
  base?: string;
  includePaths?: string[];
  excludePaths?: string[];
  overlay: ProjectOverlay | null;
}): AnalysisTarget {
  const { identity, scan, commit, base, includePaths, excludePaths, overlay } = input;
  const head = commit ?? identity.head;
  const descriptor = {
    version: 1 as const,
    head,
    ...(base !== undefined ? { base } : {}),
    ...(base !== undefined ? { diffRange: { left: base, right: head } } : {}),
    ...(includePaths !== undefined ? { includePaths } : {}),
    ...(excludePaths !== undefined ? { excludePaths } : {}),
    sourceTreeDigest: digestOf(scan.fileManifest),
    dirtyBlobs: [...scan.dirtyFiles].sort((a, b) => compareBytewise(a.path, b.path)),
    policyDigest: scan.policyDigest,
    packageDigest: blobDigest(identity, commit, "package.json"),
    typescriptConfigDigest: blobDigest(identity, commit, "tsconfig.json"),
    overlay: overlay
      ? {
          path: "contextpatrol.project.json",
          digest: digestOf(overlay),
          descriptor: overlay,
        }
      : null,
    historyEndpoint: head,
    truncated: scan.truncated,
  };
  return { ...descriptor, manifestDigest: digestOf(descriptor) };
}
