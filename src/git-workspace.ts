import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { PatrolError } from "./errors.js";
import { digestOf } from "./hash.js";

function neutralizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (/^git_/i.test(key)) {
      continue;
    }
    env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_PAGER = "cat";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.LC_ALL = "C";
  return env;
}

const SAFE_FLAGS = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

export function runGit(
  args: string[],
  cwd: string,
  maxBuffer = 64 * 1024 * 1024,
): Buffer {
  const result = spawnSync("git", [...SAFE_FLAGS, ...args], {
    cwd,
    env: neutralizedEnv(),
    encoding: "buffer",
    maxBuffer,
  });
  if (result.error) {
    throw new PatrolError("WORKSPACE_INVALID", `git failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString("utf8").trim() ?? "";
    throw new PatrolError(
      "WORKSPACE_INVALID",
      `git ${args.join(" ")} failed: ${stderr}`,
    );
  }
  return result.stdout;
}

function runGitNullable(args: string[], cwd: string): Buffer | null {
  const result = spawnSync("git", [...SAFE_FLAGS, ...args], {
    cwd,
    env: neutralizedEnv(),
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout;
}

export interface WorkspaceIdentity {
  root: string;
  projectId: string;
  workspaceId: string;
  head: string;
}

export function resolveWorkspace(startPath: string): WorkspaceIdentity {
  let root: string;
  try {
    root = runGit(["rev-parse", "--show-toplevel"], startPath).toString("utf8").trim();
  } catch {
    throw new PatrolError("WORKSPACE_INVALID", "not a Git work tree");
  }
  if (!root) {
    throw new PatrolError("WORKSPACE_INVALID", "not a Git work tree");
  }

  const head = headOf(root);
  if (!head) {
    throw new PatrolError("WORKSPACE_INVALID", "repository has no HEAD");
  }

  const commonDir = commonDirOf(root);

  const workspaceReal = realpathSync(root);
  const projectReal = realpathSync(commonDir);

  return {
    root,
    projectId: digestOf({ t: "project", path: projectReal }),
    workspaceId: digestOf({ t: "workspace", path: workspaceReal }),
    head,
  };
}

export function headOf(root: string): string {
  const out = runGitNullable(["rev-parse", "HEAD"], root);
  return out?.toString("utf8").trim() ?? "";
}

function commonDirOf(root: string): string {
  const out = runGitNullable(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    root,
  );
  if (out) {
    return out.toString("utf8").trim();
  }
  const relative = runGitNullable(["rev-parse", "--git-common-dir"], root);
  if (relative) {
    const value = relative.toString("utf8").trim();
    return isAbsolute(value) ? value : resolve(root, value);
  }
  return root;
}

/**
 * Resolve gitRef to a full commit SHA. Throws REQUEST_INVALID when unresolvable.
 */
export function resolveRef(root: string, gitRef: string): string {
  const out = runGitNullable(["rev-parse", "--verify", `${gitRef}^{commit}`], root);
  if (out === null) {
    throw new PatrolError("REQUEST_INVALID", `invalid gitRef: ${gitRef}`);
  }
  return out.toString("utf8").trim();
}

/**
 * List tree entries for a commit via `git ls-tree -r --name-only -z`.
 * Returns relative POSIX paths sorted bytewise.
 */
export function listTree(root: string, commit: string): string[] {
  const out = runGit(["ls-tree", "-r", "--name-only", "-z", commit], root);
  return out
    .toString("utf8")
    .split("\0")
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/\\/g, "/"))
    .sort();
}

/**
 * Read a blob from a commit via `git cat-file blob <commit>:<path>`.
 * Returns the raw buffer (may contain binary content).
 */
export function readBlob(root: string, commit: string, path: string): Buffer {
  return runGit(["cat-file", "blob", `${commit}:${path}`], root);
}

/**
 * Return the byte size of a blob via `git cat-file -s`.
 */
export function blobSize(root: string, commit: string, path: string): number {
  const out = runGit(["cat-file", "-s", `${commit}:${path}`], root);
  return parseInt(out.toString("utf8").trim(), 10);
}

/** Returns relative POSIX paths of tracked + untracked (non-ignored) files. */
export function listFiles(root: string): string[] {
  const out = runGit(
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    root,
  );
  return out
    .toString("utf8")
    .split("\0")
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/\\/g, "/"))
    .sort();
}

export interface DirtyEntry {
  path: string;
  status: string;
}

/** Returns dirty entries from `git status --porcelain=v1 -z`. */
export function dirtyEntries(root: string): DirtyEntry[] {
  const out = runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
  const text = out.toString("utf8");
  const entries: DirtyEntry[] = [];
  const parts = text.split("\0");
  let i = 0;
  while (i < parts.length) {
    const record = parts[i];
    if (record === undefined || record === "") {
      i += 1;
      continue;
    }
    const x = record[0] ?? " ";
    const y = record[1] ?? " ";
    const rest = record.slice(3);
    if (x === "R" || x === "C") {
      // porcelain v1 -z: record carries the destination path; the origin is
      // the following NUL-separated token.
      entries.push({ path: rest.replace(/\\/g, "/"), status: x });
      i += 2;
      continue;
    }
    const path = rest.replace(/\\/g, "/");
    entries.push({ path, status: x === "?" ? "?" : y });
    i += 1;
  }
  return entries;
}
