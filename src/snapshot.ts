import { EXTRACTOR_VERSION, POLICY_VERSION } from "./constants.js";
import type { Snapshot } from "./contracts.js";
import { dirtyEntries, listFiles, type WorkspaceIdentity } from "./git-workspace.js";
import { digestOf } from "./hash.js";
import type { FileFact } from "./model.js";
import { isDenied } from "./security.js";
import { readSource } from "./source-reader.js";
import { extractSymbols } from "./typescript-extractor.js";

export type Language = FileFact["language"];

export function languageOf(path: string): Language {
  if (/\.(ts|tsx|mts|cts)$/i.test(path)) {
    return "typescript";
  }
  if (/\.(js|jsx|mjs|cjs)$/i.test(path)) {
    return "javascript";
  }
  if (/\.(md|mdx|markdown)$/i.test(path)) {
    return "markdown";
  }
  if (/\.json$/i.test(path)) {
    return "json";
  }
  return "other";
}

export interface ScanResult {
  fileFacts: FileFact[];
  fileManifest: Array<{ path: string; digest: string }>;
  eligiblePaths: string[];
  truncated: boolean;
  dirtyDigest: string;
  policyDigest: string;
  snapshotDigest: string;
  skipped: Array<{ path: string; reason: string }>;
  dirtyEntries: Array<{ path: string; status: string }>;
  dirtyFiles: Array<{ path: string; digest: string }>;
}

export function policyDigestFor(denylist: readonly string[]): string {
  return digestOf({
    policyVersion: POLICY_VERSION,
    extractor: EXTRACTOR_VERSION,
    denylist: [...denylist],
  });
}

export async function scanWorkspace(
  identity: WorkspaceIdentity,
  denylist: readonly string[],
  maxFiles: number,
): Promise<ScanResult> {
  const allFiles = listFiles(identity.root);
  const rawDirty = dirtyEntries(identity.root);
  const dirtySet = new Set(rawDirty.map((entry) => entry.path));

  const eligible: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const path of allFiles) {
    if (isDenied(path, denylist)) {
      skipped.push({ path, reason: "denylist" });
      continue;
    }
    eligible.push(path);
  }

  const fileFacts: FileFact[] = [];
  const fileManifest: Array<{ path: string; digest: string }> = [];
  const dirtyManifest: Array<{ path: string; digest: string }> = [];
  const dirtyFiles: Array<{ path: string; digest: string }> = [];

  const scoped = eligible.slice(0, maxFiles);

  for (const path of scoped) {
    const read = await readSource(`${identity.root}/${path}`);
    if (read.skipped) {
      skipped.push({ path, reason: read.reason });
      if (dirtySet.has(path)) {
        const digest = digestOf({ path, reason: read.reason });
        dirtyManifest.push({ path, digest });
        dirtyFiles.push({ path, digest });
      }
      continue;
    }
    const digest = read.digest;
    fileManifest.push({ path, digest });

    const language = languageOf(path);
    const symbols =
      language === "typescript" || language === "javascript"
        ? extractSymbols(path, read.content)
        : [];

    fileFacts.push({
      path,
      language,
      size: read.size,
      lines: read.content.split("\n").length,
      digest,
      symbols,
    });

    if (dirtySet.has(path)) {
      dirtyManifest.push({ path, digest });
      dirtyFiles.push({ path, digest });
    }
  }

  const dirtyDigest = digestOf(dirtyManifest);

  return {
    fileFacts,
    fileManifest,
    eligiblePaths: scoped,
    truncated: eligible.length > maxFiles,
    dirtyDigest,
    policyDigest: policyDigestFor(denylist),
    snapshotDigest: "",
    skipped,
    dirtyEntries: rawDirty,
    dirtyFiles,
  };
}

export function finalizeSnapshot(
  result: ScanResult,
  identity: WorkspaceIdentity,
): { snapshot: Snapshot } {
  const sourceDigest = digestOf({
    head: identity.head,
    dirtyDigest: result.dirtyDigest,
    fileManifest: result.fileManifest,
  });
  const snapshotDigest = digestOf({
    sourceDigest,
    extractor: EXTRACTOR_VERSION,
    policy: result.policyDigest,
  });
  const snapshot: Snapshot = {
    projectId: identity.projectId,
    workspaceId: identity.workspaceId,
    head: identity.head,
    dirtyDigest: result.dirtyDigest,
    sourceDigest,
    snapshotDigest,
    extractorVersion: EXTRACTOR_VERSION,
    policyDigest: result.policyDigest,
  };
  return { snapshot };
}
