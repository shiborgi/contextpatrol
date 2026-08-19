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

test("NodeNext .js specifiers remap to TypeScript sources", () => {
  assert.deepEqual(
    resolveImport("./pack.js", "src/cli.ts", ["src/cli.ts", "src/pack.ts"]),
    {
      external: false,
      path: "src/pack.ts",
    },
  );
  assert.deepEqual(resolveImport("./util.js", "src/index.ts", ELIGIBLE), {
    external: false,
    path: "src/util.ts",
  });
});

test(".mjs and .cjs remap to .mts and .cts, not .m.ts or .c.ts", () => {
  const eligible = ["src/mod.mts", "src/mod.cts"];
  assert.deepEqual(resolveImport("./mod.mjs", "src/a.ts", eligible), {
    external: false,
    path: "src/mod.mts",
  });
  assert.deepEqual(resolveImport("./mod.cjs", "src/a.ts", eligible), {
    external: false,
    path: "src/mod.cts",
  });
});

test(".js specifier prefers an exact .js file over its .ts counterpart", () => {
  // ELIGIBLE has src/pkg/inner.js (a real .js file); a .js specifier to it
  // must not remap to a nonexistent .ts.
  assert.deepEqual(resolveImport("./pkg/inner.js", "src/index.ts", ELIGIBLE), {
    external: false,
    path: "src/pkg/inner.js",
  });
});

test("bin shim importing dist/ maps back onto the source tree", () => {
  assert.deepEqual(
    resolveImport("../dist/src/cli.js", "bin/contextpatrol.js", [
      "src/cli.ts",
      "src/pack.ts",
    ]),
    {
      external: false,
      path: "src/cli.ts",
    },
  );
});

test("dist/ strip does not apply to non-bin importers", () => {
  assert.deepEqual(resolveImport("../dist/src/cli.js", "src/a.ts", ["src/cli.ts"]), {
    external: false,
    path: null,
  });
});
