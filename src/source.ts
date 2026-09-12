import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { LIMITS, safePath } from "./contracts.js";
import { compareText, digest, sha256 } from "./json.js";

export interface SourceFile {
  path: string;
  language: string;
  content: string;
  hash: string;
}
export class Diagnostics {
  readonly messages = new Set<string>();
  truncated = false;
  add(message: string, omitted = false): void {
    this.truncated ||= omitted;
    if (this.messages.size < LIMITS.maxDiagnostics) this.messages.add(message);
    else {
      this.truncated = true;
      this.messages.add("Diagnostic limit reached; additional details omitted.");
    }
  }
  list(): string[] {
    return [...this.messages].sort(compareText);
  }
}
const DENIED_DIRS = new Set([
  ".git",
  ".codepatrol",
  ".memorypatrol",
  ".hg",
  ".svn",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".ssh",
  ".aws",
  ".azure",
  ".kube",
  ".gnupg",
  "secrets",
  "credentials",
  "keys",
]);
const SENSITIVE =
  /(?:^\.env(?:\.|$)|^\.(?:npmrc|pypirc|netrc)$|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|(?:^|[._-])(?:secrets?|credentials?|passwords?|tokens?|api[_-]?keys?)(?:[._-]|$)|\.(?:pem|key|p12|pfx|jks|keystore)$)/i;
const EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".py",
  ".pyi",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
  ".md",
  ".txt",
  ".css",
  ".scss",
  ".html",
  ".vue",
  ".svelte",
  ".go",
  ".rs",
  ".java",
  ".sh",
]);
export function excluded(relative: string): boolean {
  return relative
    .split("/")
    .some((part) => DENIED_DIRS.has(part.toLowerCase()) || SENSITIVE.test(part));
}
function language(file: string): string {
  if (path.posix.basename(file) === "go.mod") return "gomod";
  const ext = path.posix.extname(file).slice(1).toLowerCase();
  if (["ts", "tsx", "mts", "cts"].includes(ext)) return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "javascript";
  if (["py", "pyi"].includes(ext)) return "python";
  if (ext === "rs") return "rust";
  if (ext === "go") return "go";
  return ext || "text";
}
export function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g,
      "[REDACTED]",
    )
    .replace(
      /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
      "[REDACTED]",
    )
    .replace(
      /((?:["']?)(?:api[_-]?key|password|secret|token|authorization)(?:["']?)\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|`(?:\\[\s\S]|[^`\\])*(?:`|$)|[^\s,;}]+)/gi,
      '$1"[REDACTED]"',
    );
}
function contained(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
function safeAbsolute(root: string, relative: string): string {
  let current = root;
  for (const part of relative.split("/").filter(Boolean)) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("symbolic link");
  }
  if (!contained(root, realpathSync(current))) throw new Error("outside root");
  return current;
}
export function loadSource(
  requestedRoot: string,
  diagnostics: Diagnostics,
): { files: SourceFile[]; snapshot: string } {
  let root: string;
  try {
    root = realpathSync(requestedRoot);
    if (!lstatSync(root).isDirectory()) throw new Error();
  } catch {
    throw new Error("root must be an accessible directory");
  }
  const files: SourceFile[] = [];
  let entries = 0;
  let bytes = 0;
  let exhausted = false;
  const visit = (relative: string, depth: number): void => {
    if (exhausted) return;
    if (depth > LIMITS.directoryDepth) {
      diagnostics.add("Directory depth limit reached.", true);
      return;
    }
    let names: string[] = [];
    try {
      const dir = opendirSync(safeAbsolute(root, relative));
      try {
        for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
          names.push(entry.name);
          if (names.length > LIMITS.maxEntries - entries) {
            diagnostics.add(
              "Directory entry limit reached; entire over-limit directory omitted.",
              true,
            );
            exhausted = true;
            names = [];
            break;
          }
        }
      } finally {
        dir.closeSync();
      }
    } catch {
      diagnostics.add("Inaccessible or unsafe directory omitted.", true);
      return;
    }
    entries += names.length;
    for (const name of names.sort(compareText)) {
      if (exhausted) break;
      const file = relative ? `${relative}/${name}` : name;
      if (!safePath(file) || excluded(file)) {
        diagnostics.add(
          "Sensitive, dependency, generated, metadata, or unsafe paths excluded.",
          true,
        );
        continue;
      }
      let fd: number | undefined;
      try {
        const absolute = safeAbsolute(root, file);
        const stat = lstatSync(absolute);
        if (stat.isDirectory()) {
          visit(file, depth + 1);
          continue;
        }
        if (!stat.isFile()) {
          diagnostics.add("Non-regular files excluded.", true);
          continue;
        }
        if (
          !EXTENSIONS.has(path.posix.extname(file).toLowerCase()) &&
          !["Dockerfile", "Makefile", "go.mod"].includes(name)
        ) {
          diagnostics.add("Unsupported file types excluded.", true);
          continue;
        }
        if (stat.size > LIMITS.maxFileBytes) {
          diagnostics.add("Oversized files excluded (262144 bytes per file).", true);
          continue;
        }
        if (
          files.length >= LIMITS.maxFiles ||
          bytes + stat.size > LIMITS.maxSourceBytes
        ) {
          diagnostics.add("Source file or total byte analysis limit reached.", true);
          exhausted = true;
          break;
        }
        fd = openSync(
          absolute,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const before = fstatSync(fd);
        if (
          !before.isFile() ||
          before.ino !== stat.ino ||
          before.dev !== stat.dev ||
          before.size !== stat.size
        )
          throw new Error("changed file");
        const buffer = Buffer.alloc(stat.size + 1);
        let count = 0;
        while (count < buffer.length) {
          const n = readSync(fd, buffer, count, buffer.length - count, null);
          if (!n) break;
          count += n;
        }
        const after = fstatSync(fd);
        safeAbsolute(root, file);
        if (
          count !== stat.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs
        )
          throw new Error("changed file");
        bytes += count;
        const content = buffer.subarray(0, count);
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(content);
        } catch {
          diagnostics.add("Binary or non-UTF-8 files excluded.", true);
          continue;
        }
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Binary control bytes are deliberately excluded.
        if (/[\x00-\x08\x0e-\x1f]/.test(text)) {
          diagnostics.add("Binary or non-UTF-8 files excluded.", true);
          continue;
        }
        const redacted = redact(text);
        if (redacted !== text)
          diagnostics.add(
            "Credential-shaped source content redacted; detection is best-effort.",
          );
        files.push({
          path: file,
          language: language(file),
          content: redacted,
          hash: sha256(content),
        });
      } catch {
        diagnostics.add(
          "Symlink, inaccessible, unsafe, or concurrently changed files excluded.",
          true,
        );
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
  };
  visit("", 0);
  files.sort((a, b) => compareText(a.path, b.path));
  const snapshot = digest({
    semantics: "contextpatrol/1.0.0/filesystem-ast-local",
    limits: LIMITS,
    files: files.map((file) => ({ path: file.path, hash: file.hash })),
    diagnostics: diagnostics.list(),
  });
  return { files, snapshot };
}
