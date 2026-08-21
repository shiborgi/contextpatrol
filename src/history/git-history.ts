import { runGit } from "../git-workspace.js";
import { compareBytewise } from "../hash.js";
import { canonicalizePath, isDenied } from "../security.js";

export interface HistoryResult {
  churn: Array<{ path: string; count: number }>;
  coChange: Array<{ pathA: string; pathB: string; count: number }>;
}

export function mineHistory(
  root: string,
  denylist: readonly string[],
  maxCommits = 2000,
  endpoint = "HEAD",
): HistoryResult {
  let output = "";
  try {
    output = runGit(
      [
        "log",
        "--numstat",
        "--no-renames",
        `-n${maxCommits}`,
        "--pretty=format:COMMIT",
        endpoint,
      ],
      root,
    ).toString("utf8");
  } catch {
    // If git log fails (e.g. shallow clone or empty repo), return empty
    return { churn: [], coChange: [] };
  }

  return parseNumstat(output, denylist);
}

export function parseNumstat(
  output: string,
  denylist: readonly string[],
): HistoryResult {
  const commits = output.split(/(?:^|\n)COMMIT(?:\n|$)/);
  const churnMap = new Map<string, number>();
  const coChangeMap = new Map<string, number>();

  for (const chunk of commits) {
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0 || lines.length > 50) {
      continue;
    }

    const commitFiles: string[] = [];

    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 3) {
        continue;
      }
      const rawAdded = parts[0]!;
      const rawDeleted = parts[1]!;
      const rawPath = parts[2]!;

      const canonical = canonicalizePath(rawPath);
      if (canonical === null || isDenied(canonical, denylist)) {
        continue;
      }

      const added = rawAdded === "-" ? 0 : parseInt(rawAdded, 10) || 0;
      const deleted = rawDeleted === "-" ? 0 : parseInt(rawDeleted, 10) || 0;
      const fileChurn = added + deleted;

      churnMap.set(canonical, (churnMap.get(canonical) ?? 0) + fileChurn);
      if (!commitFiles.includes(canonical)) {
        commitFiles.push(canonical);
      }
    }

    // Co-change pairs
    commitFiles.sort(compareBytewise);
    for (let i = 0; i < commitFiles.length; i++) {
      const fileA = commitFiles[i]!;
      for (let j = i + 1; j < commitFiles.length; j++) {
        const fileB = commitFiles[j]!;
        const key = `${fileA}::${fileB}`;
        coChangeMap.set(key, (coChangeMap.get(key) ?? 0) + 1);
      }
    }
  }

  const churn = [...churnMap.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => compareBytewise(a.path, b.path));

  const coChange = [...coChangeMap.entries()]
    .map(([key, count]) => {
      const [pathA, pathB] = key.split("::");
      return { pathA: pathA!, pathB: pathB!, count };
    })
    .sort((a, b) => {
      const keyA = `${a.pathA}::${a.pathB}`;
      const keyB = `${b.pathA}::${b.pathB}`;
      return compareBytewise(keyA, keyB);
    });

  return { churn, coChange };
}
