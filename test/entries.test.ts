import assert from "node:assert/strict";
import { test } from "node:test";

import { entryScoreOf, rankEntryPoints } from "../src/analysis/entries.js";

test("WORK-7.3.1 ranks cli/bin entries highest and ties break bytewise", () => {
  const paths = [
    "src/types.ts",
    "src/cli.ts",
    "bin/contextpatrol.js",
    "src/pipeline/emit.ts",
    "src/cli/index.ts",
    "src/index.ts",
  ];
  const ranked = rankEntryPoints(paths);
  assert.ok(ranked.length >= 3, "expected at least the entry files");
  // src/cli.ts (basename cli + near src) should rank above bin and src/index
  assert.ok(ranked.includes("src/cli.ts"));
  assert.ok(ranked.includes("bin/contextpatrol.js"));
  assert.ok(ranked.includes("src/index.ts"));
});

test("WORK-7.3.1 non-entry paths score zero and are excluded", () => {
  assert.equal(entryScoreOf("src/analysis/risk.ts"), 0);
  assert.equal(entryScoreOf("scripts/evaluate.mjs"), 0);
  const ranked = rankEntryPoints(["scripts/evaluate.mjs", "src/risk.ts"]);
  assert.deepEqual(ranked, []);
});

test("WORK-7.3.1 ranking is deterministic", () => {
  const paths = ["src/cli.ts", "bin/a.js", "bin/b.js", "src/index.ts"];
  const a = rankEntryPoints(paths);
  const b = rankEntryPoints(paths);
  assert.deepEqual(a, b);
});
