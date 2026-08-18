import { runGit } from "../git-workspace.js";
import type { FileFact } from "../model.js";
import { canonicalizePath, isDenied } from "../security.js";

export function mapDiff(
  root: string,
  fileFacts: FileFact[],
  denylist: readonly string[],
  changedPaths: string[] = [],
): Set<string> {
  const changedSymbols = new Set<string>();

  let diffOutput = "";
  try {
    diffOutput = runGit(["diff", "--unified=0", "HEAD"], root).toString("utf8");
  } catch {
    // If git diff fails, treat changedPaths as whole-file scope if provided
    diffOutput = "";
  }

  const hunksByPath = new Map<string, Array<{ start: number; end: number }>>();
  const lines = diffOutput.split("\n");
  let currentPath: string | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      // Parse path from diff --git a/path b/path
      const match = /b\/(.+)$/.exec(line);
      if (match && match[1]) {
        const rawPath = match[1].trim();
        const canonical = canonicalizePath(rawPath);
        if (canonical !== null && !isDenied(canonical, denylist)) {
          currentPath = canonical;
        } else {
          currentPath = null;
        }
      }
    } else if (currentPath && line.startsWith("@@ ")) {
      // Parse hunk header: @@ -l,c +l,c @@ or @@ -l +l @@
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (match) {
        const start = parseInt(match[1]!, 10);
        const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        const end = start + count - 1;
        // Only record valid hunks (deletions-only have count 0, so end < start)
        if (end >= start) {
          const hunks = hunksByPath.get(currentPath) ?? [];
          hunks.push({ start, end });
          hunksByPath.set(currentPath, hunks);
        }
      }
    }
  }

  // Map hunks to symbols
  const processedPaths = new Set<string>();
  for (const [path, hunks] of hunksByPath) {
    processedPaths.add(path);
    const file = fileFacts.find((f) => f.path === path);
    if (!file) {
      continue;
    }
    for (const sym of file.symbols) {
      for (const hunk of hunks) {
        if (sym.range.startLine <= hunk.end && sym.range.endLine >= hunk.start) {
          changedSymbols.add(sym.qualifiedName);
        }
      }
    }
  }

  // Fallback for changedPaths: if a path is in changedPaths but wasn't processed in the diff hunks,
  // map all its symbols.
  for (const rawPath of changedPaths) {
    const canonical = canonicalizePath(rawPath);
    if (canonical === null || isDenied(canonical, denylist)) {
      continue;
    }
    if (!processedPaths.has(canonical)) {
      const file = fileFacts.find((f) => f.path === canonical);
      if (file) {
        for (const sym of file.symbols) {
          changedSymbols.add(sym.qualifiedName);
        }
      }
    }
  }

  return changedSymbols;
}
