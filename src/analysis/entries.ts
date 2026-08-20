import { compareBytewise } from "../hash.js";

// WORK-7.3.1: deterministic entry-point scoring. Higher beats lower; ties break
// bytewise on the path, so two packs of the same tree always agree.
const ENTRY_BASENAME = /^(cli|index|main|app|server)\.(ts|js|tsx|jsx|mts|cts)$/i;

export function entryScoreOf(path: string): number {
  const top = path.split("/")[0];
  const base = path.split("/").pop() ?? path;
  let score = 0;
  if (top === "bin") {
    score += 2;
  }
  if (path.startsWith("src/cli/")) {
    score += 1;
  }
  const nearSrc = path.startsWith("src/") || !path.includes("/");
  if (ENTRY_BASENAME.test(base) && nearSrc) {
    score += 3;
  }
  return score;
}

export function rankEntryPoints(paths: readonly string[]): string[] {
  return [...paths]
    .map((p) => ({ p, score: entryScoreOf(p) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || compareBytewise(a.p, b.p))
    .map((e) => e.p);
}
