import { LIMITS } from "../constants.js";
import { PatrolError } from "../errors.js";
import {
  dirtyEntries,
  headOf,
  listFiles,
  resolveRef,
  type WorkspaceIdentity,
} from "../git-workspace.js";
import { compareBytewise, digestOf } from "../hash.js";
import { isDenied } from "../security.js";
import type { ScanResult } from "../snapshot.js";
import { readSource } from "../source-reader.js";

export async function verifyUnchanged(
  identity: WorkspaceIdentity,
  denylist: readonly string[],
  scan: ScanResult,
  gitRef?: string,
  expectedHead?: string,
): Promise<void> {
  if (gitRef !== undefined) {
    const current = resolveRef(identity.root, gitRef);
    if (expectedHead && current !== expectedHead) {
      throw new PatrolError(
        "SOURCE_CHANGED",
        `gitRef ${gitRef} moved during the operation`,
      );
    }
    return;
  }

  if (headOf(identity.root) !== identity.head) {
    throw new PatrolError(
      "SOURCE_CHANGED",
      "workspace HEAD changed during the operation",
    );
  }

  const afterFiles = listFiles(identity.root)
    .filter((p) => !isDenied(p, denylist))
    .slice(0, LIMITS.maxFiles)
    .sort(compareBytewise);
  if (
    afterFiles.join("\0") !==
    scan.eligiblePaths.slice().sort(compareBytewise).join("\0")
  ) {
    throw new PatrolError(
      "SOURCE_CHANGED",
      "workspace files changed during the operation",
    );
  }

  const norm = (e: { path: string; status: string }) => `${e.path}\0${e.status}`;
  const beforeDirty = scan.dirtyEntries.map(norm).sort(compareBytewise).join("\n");
  const afterDirty = dirtyEntries(identity.root)
    .map(norm)
    .sort(compareBytewise)
    .join("\n");
  if (beforeDirty !== afterDirty) {
    throw new PatrolError(
      "SOURCE_CHANGED",
      "workspace dirty state changed during the operation",
    );
  }

  for (const file of scan.dirtyFiles) {
    const read = await readSource(`${identity.root}/${file.path}`);
    const digest = read.skipped
      ? digestOf({ path: file.path, reason: read.reason })
      : read.digest;
    if (digest !== file.digest) {
      throw new PatrolError(
        "SOURCE_CHANGED",
        `file ${file.path} changed during the operation`,
      );
    }
  }
}
