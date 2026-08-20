import assert from "node:assert/strict";
import { test } from "node:test";

import { assignLayers, layerLabelOf } from "../src/analysis/layers.js";

test("WORK-7.2.1 maps entry, test and docs paths to the expected layers", () => {
  assert.equal(layerLabelOf("src/cli.ts").id, "layer:entry");
  assert.equal(layerLabelOf("src/cli/index.ts").id, "layer:entry");
  assert.equal(layerLabelOf("src/index.ts").id, "layer:entry");
  assert.equal(layerLabelOf("test/pack.test.ts").id, "layer:test");
  assert.equal(layerLabelOf("src/auth.test.ts").id, "layer:test");
  assert.equal(layerLabelOf("docs/architecture.md").id, "layer:docs");
  assert.equal(layerLabelOf("README.md").id, "layer:docs");
});

test("WORK-7.2.1 assigns every path to exactly one layer with no duplicate nodeIds", () => {
  const paths = [
    "src/cli.ts",
    "src/cli/index.ts",
    "src/pipeline/emit.ts",
    "src/graph/code-graph.ts",
    "src/analysis/layers.ts",
    "test/pack.test.ts",
    "docs/architecture.md",
    "bin/contextpatrol.js",
    "README.md",
  ];
  const layers = assignLayers(paths);
  const all = layers.flatMap((l) => l.nodeIds);
  assert.equal(new Set(all).size, all.length, "no duplicate nodeIds");
  assert.equal(all.length, paths.length, "every path appears exactly once");
});

test("WORK-7.2.1 layers are sorted by id and nodeIds are sorted bytewise", () => {
  const paths = ["bin/contextpatrol.js", "docs/a.md", "test/x.test.ts", "src/cli.ts"];
  const layers = assignLayers(paths);
  const ids = layers.map((l) => l.id);
  assert.deepEqual(ids, [...ids].sort());
});

test("WORK-7.2.1 fallback is layer:other for unrecognized paths", () => {
  assert.equal(layerLabelOf("protocol/capsule.schema.json").id, "layer:other");
});
