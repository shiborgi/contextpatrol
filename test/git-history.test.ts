import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNumstat } from "../src/history/git-history.js";

test("parses normal commit and accumulates churn and co-change", () => {
  const output = [
    "COMMIT",
    "10\t5\tsrc/auth.ts",
    "2\t0\tsrc/util.ts",
    "COMMIT",
    "1\t1\tsrc/auth.ts",
  ].join("\n");

  const res = parseNumstat(output, []);
  assert.equal(res.churn.length, 2);
  assert.deepEqual(res.churn[0], { path: "src/auth.ts", count: 17 }); // 15 + 2
  assert.deepEqual(res.churn[1], { path: "src/util.ts", count: 2 });

  assert.equal(res.coChange.length, 1);
  assert.deepEqual(res.coChange[0], {
    pathA: "src/auth.ts",
    pathB: "src/util.ts",
    count: 1,
  });
});

test("skips commits with more than 50 files", () => {
  const lines = ["COMMIT"];
  for (let i = 0; i < 51; i++) {
    lines.push(`1\t0\tsrc/file${i}.ts`);
  }
  const output = lines.join("\n");

  const res = parseNumstat(output, []);
  assert.equal(res.churn.length, 0);
  assert.equal(res.coChange.length, 0);
});

test("respects denylist and path canonicalization", () => {
  const output = ["COMMIT", "1\t0\tsecret/credentials", "1\t0\tsrc/auth.ts"].join("\n");

  const res = parseNumstat(output, ["secret"]);
  assert.equal(res.churn.length, 1);
  assert.equal(res.churn[0]?.path, "src/auth.ts");
});

test("is deterministic across runs", () => {
  const output = ["COMMIT", "10\t5\tsrc/util.ts", "1\t0\tsrc/auth.ts"].join("\n");

  const a = parseNumstat(output, []);
  const b = parseNumstat(output, []);
  assert.deepEqual(a, b);
});
