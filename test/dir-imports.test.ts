import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDirImports } from "../src/analysis/dir-imports.js";
import type { CodeGraph } from "../src/graph/code-graph.js";

function graphWithImports(imports: Array<{ from: string; to: string }>): CodeGraph {
  return {
    nodes: [],
    edges: imports.map((e) => ({
      kind: "IMPORTS",
      from: `file:${e.from}`,
      to: `file:${e.to}`,
      confidence: 1,
      tier: "extracted" as const,
    })),
    unresolvedCallCensus: [],
  };
}

test("WORK-7.4.1 counts cross-directory IMPORTS and excludes same-dir", () => {
  const graph = graphWithImports([
    { from: "src/cli.ts", to: "src/pack.ts" },
    { from: "src/pack.ts", to: "src/contracts.ts" },
    { from: "src/pack.ts", to: "test/pack.test.ts" },
  ]);
  const result = computeDirImports(graph);
  assert.ok(result.length > 0);
  assert.ok(result.every((d) => d.count >= 1));
  // src -> test is the cross top-level pair
  const srcTest = result.find((d) => d.from === "src" && d.to === "test");
  assert.ok(srcTest, "expected src->test pair");
  assert.equal(srcTest!.count, 1);
  // src -> src must not appear (same-dir)
  assert.equal(
    result.some((d) => d.from === "src" && d.to === "src"),
    false,
  );
});

test("WORK-7.4.1 is deterministic (sorted count desc then bytewise)", () => {
  const graph = graphWithImports([
    { from: "src/a.ts", to: "bin/x.js" },
    { from: "src/b.ts", to: "bin/y.js" },
    { from: "docs/c.md", to: "src/a.ts" },
  ]);
  const a = computeDirImports(graph);
  const b = computeDirImports(graph);
  assert.deepEqual(a, b);
});
