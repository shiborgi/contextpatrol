import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { LIMITS, SOURCE_EXTENSIONS } from "./constants.js";
import { ContextPatrolError } from "./errors.js";
import { compareText, digest } from "./json.js";
import type { QueryRequest, SourceFile } from "./types.js";

const DENIED_PARTS = new Set([".git", ".hg", ".svn", "dist", "node_modules", "vendor"]);
const DENIED_NAMES = [
  /^\.env(?:\.|$)/,
  /\.pem$/i,
  /\.key$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)$/,
];
const REDACTIONS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /((?:api[_-]?key|password|secret|token)\s*[:=]\s*)[^\s,}]{8,}/gi,
];

export interface LoadedSource {
  root: string;
  kind: "working-tree" | "commit";
  commit: string;
  dirtyDigest: string;
  contentDigest: string;
  files: SourceFile[];
  changes: Array<{ path: string; status: "added" | "modified" | "deleted" }>;
  skippedBinary: number;
  skippedOversized: number;
  eligibleFiles: number;
}

function git(root: string, args: string[], encoding: "utf8" | "buffer" = "utf8") {
  try {
    return execFileSync("git", ["-c", "core.quotepath=false", "-C", root, ...args], {
      encoding: encoding === "buffer" ? "buffer" : "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_NO_LAZY_FETCH: "1",
        LC_ALL: "C",
      },
    });
  } catch {
    throw new ContextPatrolError(
      "SOURCE_INVALID",
      "cannot read the requested Git source",
    );
  }
}

function nulList(value: Buffer | string): string[] {
  return value.toString().split("\0").filter(Boolean).sort(compareText);
}

function allowedPath(file: string, request: QueryRequest): boolean {
  const normalized = file.split(path.sep).join("/");
  const parts = normalized.split("/");
  if (parts.some((part) => DENIED_PARTS.has(part))) return false;
  const name = parts.at(-1) ?? "";
  if (DENIED_NAMES.some((pattern) => pattern.test(name))) return false;
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase()))
    return false;
  if (
    request.includePaths &&
    !request.includePaths.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    )
  )
    return false;
  if (
    request.excludePaths?.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    )
  )
    return false;
  return true;
}

function assertSafeFile(root: string, relative: string): string {
  const absolute = path.join(root, relative);
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new ContextPatrolError("SOURCE_INVALID", "symbolic links are not analyzed");
  }
  const resolved = realpathSync(absolute);
  if (!resolved.startsWith(`${root}${path.sep}`))
    throw new ContextPatrolError("SOURCE_INVALID", "source path escapes the workspace");
  return resolved;
}

function redact(text: string): string {
  let output = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  for (const pattern of REDACTIONS) output = output.replace(pattern, "$1[REDACTED]");
  return output;
}

function language(file: string): string {
  const extension = path.posix.extname(file).slice(1).toLowerCase();
  return extension || "text";
}

function sourceFile(file: string, content: Buffer): SourceFile | undefined {
  if (content.includes(0)) return undefined;
  const text = redact(content.toString("utf8"));
  return {
    path: file,
    content: text,
    hash: digest(text),
    language: language(file),
    lines: text.length === 0 ? 0 : text.split("\n").length,
  };
}

function readTarget(
  root: string,
  request: QueryRequest,
  target: { kind: "working-tree" } | { kind: "commit"; oid: string },
): {
  files: SourceFile[];
  eligibleFiles: number;
  skippedBinary: number;
  skippedOversized: number;
} {
  const listed =
    target.kind === "working-tree"
      ? nulList(git(root, ["ls-files", "-co", "--exclude-standard", "-z"], "buffer"))
      : nulList(
          git(root, ["ls-tree", "-r", "-z", "--name-only", target.oid], "buffer"),
        );
  const eligible = listed.filter((file) => allowedPath(file, request));
  if (eligible.length > LIMITS.maxFiles)
    throw new ContextPatrolError(
      "SOURCE_INVALID",
      `source exceeds the ${LIMITS.maxFiles}-file analysis limit`,
    );
  const files: SourceFile[] = [];
  let skippedBinary = 0;
  let skippedOversized = 0;
  for (const file of eligible) {
    if (target.kind === "working-tree" && !existsSync(path.join(root, file))) continue;
    const content =
      target.kind === "working-tree"
        ? readFileSync(assertSafeFile(root, file))
        : (git(root, ["show", `${target.oid}:${file}`], "buffer") as Buffer);
    if (content.length > LIMITS.maxFileBytes) {
      skippedOversized += 1;
      continue;
    }
    const parsed = sourceFile(file, content);
    if (!parsed) skippedBinary += 1;
    else files.push(parsed);
  }
  return {
    files,
    eligibleFiles: eligible.length,
    skippedBinary,
    skippedOversized,
  };
}

function compareSources(
  baseline: SourceFile[],
  target: SourceFile[],
): Array<{ path: string; status: "added" | "modified" | "deleted" }> {
  const before = new Map(baseline.map((file) => [file.path, file.hash]));
  const after = new Map(target.map((file) => [file.path, file.hash]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort(compareText);
  const changes: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
  }> = [];
  for (const file of paths) {
    if (!before.has(file)) changes.push({ path: file, status: "added" });
    else if (!after.has(file)) changes.push({ path: file, status: "deleted" });
    else if (before.get(file) !== after.get(file))
      changes.push({ path: file, status: "modified" });
  }
  return changes;
}

export function loadSource(request: QueryRequest): LoadedSource {
  const root = realpathSync(request.workspace);
  const top = realpathSync(
    (git(root, ["rev-parse", "--show-toplevel"]) as string).trim(),
  );
  if (top !== root)
    throw new ContextPatrolError("SOURCE_INVALID", "workspace must be the Git root");
  const head = (git(root, ["rev-parse", "HEAD"]) as string).trim();
  const commit =
    request.target.kind === "commit"
      ? (git(root, ["rev-parse", `${request.target.oid}^{commit}`]) as string).trim()
      : head;
  if (request.target.kind === "commit" && commit !== request.target.oid)
    throw new ContextPatrolError(
      "SOURCE_INVALID",
      "target object id does not resolve exactly",
    );
  const target = readTarget(root, request, request.target);
  const needsBaseline =
    request.facets.includes("changes") || request.facets.includes("tests");
  const baselineOid = needsBaseline
    ? (request.baseline?.oid ??
      (request.target.kind === "working-tree" ? head : undefined))
    : undefined;
  const baseline = baselineOid
    ? readTarget(root, request, { kind: "commit", oid: baselineOid }).files
    : [];
  const changes = baselineOid ? compareSources(baseline, target.files) : [];
  const contentDigest = digest(
    target.files.map(({ path: file, hash }) => [file, hash]),
  );
  return {
    root,
    kind: request.target.kind,
    commit,
    dirtyDigest: request.target.kind === "working-tree" ? digest(changes) : digest([]),
    contentDigest,
    files: target.files,
    changes,
    skippedBinary: target.skippedBinary,
    skippedOversized: target.skippedOversized,
    eligibleFiles: target.eligibleFiles,
  };
}

export function verifySourceUnchanged(request: QueryRequest, expected: string): void {
  if (request.target.kind !== "working-tree") return;
  if (loadSource(request).contentDigest !== expected)
    throw new ContextPatrolError("SOURCE_CHANGED", "source changed during analysis");
}
