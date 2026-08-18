import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveImport } from "../src/extract/import-resolver.js";

const ELIGIBLE = [
  "src/index.ts",
  "src/util.ts",
  "src/deep/mod.tsx",
  "src/pkg/index.ts",
  "src/pkg/inner.js",
];

test("bare specifiers return external with no path", () => {
  assert.deepEqual(resolveImport("lodash", "src/a.ts", ELIGIBLE), {
    external: true,
    path: null,
  });
  assert.deepEqual(resolveImport("node:path", "src/a.ts", ELIGIBLE), {
    external: true,
    path: null,
  });
  assert.deepEqual(resolveImport("@scope/pkg", "src/a.ts", ELIGIBLE), {
    external: true,
    path: null,
  });
});

test("relative specifiers resolve with extension probing in order", () => {
  assert.deepEqual(resolveImport("./util", "src/index.ts", ELIGIBLE), {
    external: false,
    path: "src/util.ts",
  });
  assert.deepEqual(resolveImport("./deep/mod", "src/index.ts", ELIGIBLE), {
    external: false,
    path: "src/deep/mod.tsx",
  });
  assert.deepEqual(resolveImport("../util", "src/deep/mod.tsx", ELIGIBLE), {
    external: false,
    path: "src/util.ts",
  });
});

test("directory specifiers resolve to index files", () => {
  assert.deepEqual(resolveImport("./pkg", "src/index.ts", ELIGIBLE), {
    external: false,
    path: "src/pkg/index.ts",
  });
  assert.deepEqual(resolveImport("./pkg/inner", "src/index.ts", ELIGIBLE), {
    external: false,
    path: "src/pkg/inner.js",
  });
});

test("unresolvable relative specifier returns non-external with null path", () => {
  assert.deepEqual(resolveImport("./missing", "src/index.ts", ELIGIBLE), {
    external: false,
    path: null,
  });
});

test("specifier escaping the workspace root is rejected", () => {
  assert.deepEqual(resolveImport("../../outside", "src/a.ts", ELIGIBLE), {
    external: true,
    path: null,
  });
});

test("exact path with extension resolves directly", () => {
  assert.deepEqual(resolveImport("./util.ts", "src/index.ts", ELIGIBLE), {
    external: false,
    path: "src/util.ts",
  });
});
