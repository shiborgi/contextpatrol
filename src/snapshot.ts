import { EXTRACTOR_VERSION, LIMITS, POLICY_VERSION } from "./constants.js";
import type { Snapshot } from "./contracts.js";
import {
  blobSize,
  dirtyEntries,
  listFiles,
  listTree,
  readBlob,
  type WorkspaceIdentity,
} from "./git-workspace.js";
import { digestOf, digestOfBytes } from "./hash.js";
import type { FileFact } from "./model.js";
import { isDenied, matchesInclude } from "./security.js";
import { readSource } from "./source-reader.js";
import type { ExtractionResult } from "./typescript-extractor.js";
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
  commitSha?: string,
  includePaths?: readonly string[],
): Promise<ScanResult> {
  if (commitSha !== undefined) {
    return scanFromRef(identity, denylist, maxFiles, commitSha, includePaths);
  }

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
    if (!matchesInclude(path, includePaths)) {
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
    const isTsOrJs = language === "typescript" || language === "javascript";
    const extraction: ExtractionResult = isTsOrJs
      ? extractSymbols(path, read.content)
      : { symbols: [], imports: [], calls: [], rationale: [], routes: [] };

    fileFacts.push({
      path,
      language,
      size: read.size,
      lines: read.content.split("\n").length,
      digest,
      symbols: extraction.symbols,
      imports: extraction.imports,
      calls: extraction.calls,
      rationale: extraction.rationale,
      routes: extraction.routes,
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
  commitSha?: string,
): { snapshot: Snapshot } {
  const head = commitSha ?? identity.head;
  const sourceDigest = digestOf({
    head,
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
    head,
    dirtyDigest: result.dirtyDigest,
    sourceDigest,
    snapshotDigest,
    extractorVersion: EXTRACTOR_VERSION,
    policyDigest: result.policyDigest,
  };
  return { snapshot };
}

async function scanFromRef(
  identity: WorkspaceIdentity,
  denylist: readonly string[],
  maxFiles: number,
  commitSha: string,
  includePaths?: readonly string[],
): Promise<ScanResult> {
  const allPaths = listTree(identity.root, commitSha);

  const eligible: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const path of allPaths) {
    if (isDenied(path, denylist)) {
      skipped.push({ path, reason: "denylist" });
      continue;
    }
    if (!matchesInclude(path, includePaths)) {
      continue;
    }
    eligible.push(path);
  }

  const fileFacts: FileFact[] = [];
  const fileManifest: Array<{ path: string; digest: string }> = [];

  const scoped = eligible.slice(0, maxFiles);

  for (const path of scoped) {
    let size: number;
    try {
      size = blobSize(identity.root, commitSha, path);
    } catch {
      skipped.push({ path, reason: "read-error" });
      continue;
    }
    if (size > LIMITS.maxFileBytes) {
      skipped.push({ path, reason: "too-large" });
      continue;
    }

    let buf: Buffer;
    try {
      buf = readBlob(identity.root, commitSha, path);
    } catch {
      skipped.push({ path, reason: "read-error" });
      continue;
    }
    if (buf.includes(0)) {
      skipped.push({ path, reason: "binary" });
      continue;
    }

    const content = buf.toString("utf8");
    const digest = digestOfBytes(buf);

    fileManifest.push({ path, digest });

    const language = languageOf(path);
    const isTsOrJs = language === "typescript" || language === "javascript";
    const extraction: ExtractionResult = isTsOrJs
      ? extractSymbols(path, content)
      : { symbols: [], imports: [], calls: [], rationale: [], routes: [] };

    fileFacts.push({
      path,
      language,
      size,
      lines: content.split("\n").length,
      digest,
      symbols: extraction.symbols,
      imports: extraction.imports,
      calls: extraction.calls,
      rationale: extraction.rationale,
      routes: extraction.routes,
    });
  }

  const dirtyDigest = digestOf([]);

  return {
    fileFacts,
    fileManifest,
    eligiblePaths: scoped,
    truncated: eligible.length > maxFiles,
    dirtyDigest,
    policyDigest: policyDigestFor(denylist),
    snapshotDigest: "",
    skipped,
    dirtyEntries: [],
    dirtyFiles: [],
  };
}
