import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LIMITS } from "../src/contracts.js";
import {
  canonicalJson,
  digest,
  PROFILES,
  parseQuery,
  type QueryResponse,
  query,
} from "../src/index.js";
import { finalize } from "../src/selection.js";
import { Diagnostics, loadSource, redact } from "../src/source.js";

async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  files: Record<string, string | Buffer>,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contextpatrol-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return root;
}
const request = (root: string) => ({
  protocolVersion: "1.0" as const,
  root,
  task: "repair validation",
  budget: { maxFiles: 100, maxBytes: 64000, maxDepth: 10 },
});
function assertResponse(report: QueryResponse, maxBytes = 64000): void {
  assert.deepEqual(
    Object.keys(report).sort(),
    [
      "protocolVersion",
      "profile",
      "snapshot",
      "signals",
      "files",
      "graph",
      "diagnostics",
      "stats",
      "digest",
    ].sort(),
  );
  assert.equal(report.protocolVersion, "1.0");
  assert.match(report.snapshot, /^[a-f0-9]{64}$/);
  assert.match(report.digest, /^[a-f0-9]{64}$/);
  const { digest: actual, ...payload } = report;
  assert.equal(
    actual,
    createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  );
  assert.ok(Buffer.byteLength(canonicalJson(report)) + 1 <= maxBytes);
  assert.equal(report.stats.selectedFiles, report.files.length);
  assert.deepEqual(report.graph.nodes, report.files.map((file) => file.path).sort());
  for (const edge of report.graph.edges) {
    assert.deepEqual(Object.keys(edge).sort(), ["from", "kind", "to"]);
    assert.equal(edge.kind, "imports");
    assert.ok(
      report.graph.nodes.includes(edge.from) && report.graph.nodes.includes(edge.to),
    );
  }
  for (const cycle of report.graph.cycles) {
    assert.equal(cycle[0], cycle.at(-1));
    for (let i = 1; i < cycle.length; i++)
      assert.ok(
        report.graph.edges.some(
          (edge) => edge.from === cycle[i - 1] && edge.to === cycle[i],
        ),
      );
  }
  for (const file of report.graph.impacted)
    assert.ok(report.graph.nodes.includes(file));
}

test("closed 1.0 request, defaults, exact limits, and path attacks", () => {
  const good = { protocolVersion: "1.0", root: process.cwd(), task: "test" };
  assert.deepEqual(parseQuery(good).budget, {
    maxFiles: 30,
    maxBytes: 24000,
    maxDepth: 2,
  });
  assert.equal(parseQuery(good).profile, "overview");
  for (const input of [
    null,
    [],
    {},
    { ...good, protocolVersion: "1.1" },
    { ...good, protocolVersion: 2 },
    { ...good, schemaVersion: 1 },
    { ...good, root: "." },
    { ...good, task: " " },
    { ...good, task: "x".repeat(8193) },
    { ...good, profile: null },
    { ...good, paths: null },
    { ...good, profile: "build-work" },
    { ...good, budget: { maxOutputBytes: 2048 } },
  ])
    assert.throws(() => parseQuery(input));
  for (const bad of [
    "../a.ts",
    "a/../b.ts",
    "/tmp/a.ts",
    "C:/a.ts",
    "C:foo",
    "\\\\server\\a",
    "a\\b.ts",
    "a//b.ts",
    "./a.ts",
    "a/",
    "a\0.ts",
    "*.ts",
    "src/[a].ts",
  ])
    assert.throws(() => parseQuery({ ...good, paths: [bad] }), bad);
  for (const [key, values] of Object.entries({
    maxFiles: [0, -1, 501, 1.5, "2"],
    maxBytes: [0, 1023, 1048577, NaN],
    maxDepth: [-1, 21, 0.5, null],
  }))
    for (const value of values)
      assert.throws(() => parseQuery({ ...good, budget: { [key]: value } }));
  assert.deepEqual(
    parseQuery({
      ...good,
      paths: ["b.ts", "a.ts", "b.ts"],
      budget: { maxBytes: 1024, maxDepth: 0, maxFiles: 1 },
    }).paths,
    ["a.ts", "b.ts"],
  );
});

test("real JS/TS imports, reexports, dynamic literals, impact and cycles", async (t) => {
  const root = await fixture(t, {
    "src/a.ts": 'import { b } from "./b.js"; export const validation = b;\n',
    "src/b.ts": 'export { validation as b } from "./a";\n',
    "src/c.js": 'const a = require("./a"); import("./nested");\n',
    "src/d.mts": 'import c = require("./c.js"); export * from "./a.js";\n',
    "src/nested/index.ts": "export const nested = 1;\n",
    "src/noise.ts":
      '// import "./a"\nconst text = `require("./a")`; import(missing);\n',
    "unrelated.ts": "export const other = 1;\n",
  });
  const report = await query({ ...request(root), paths: ["src/a.ts"] });
  assertResponse(report);
  assert.deepEqual(report.graph.edges, [
    { from: "src/a.ts", to: "src/b.ts", kind: "imports" },
    { from: "src/b.ts", to: "src/a.ts", kind: "imports" },
    { from: "src/c.js", to: "src/a.ts", kind: "imports" },
    { from: "src/c.js", to: "src/nested/index.ts", kind: "imports" },
    { from: "src/d.mts", to: "src/a.ts", kind: "imports" },
    { from: "src/d.mts", to: "src/c.js", kind: "imports" },
  ]);
  assert.deepEqual(report.graph.impacted, ["src/b.ts", "src/c.js", "src/d.mts"]);
  assert.deepEqual(report.graph.cycles, [["src/a.ts", "src/b.ts", "src/a.ts"]]);
  assert.ok(
    report.files.some((file) => file.path === "unrelated.ts"),
    "seed paths are not filters",
  );
  assert.ok(report.files[0]?.reasons.includes("explicit seed"));
  assert.ok(report.diagnostics.some((text) => text.includes("Nonliteral")));
  assert.ok(
    report.files
      .find((file) => file.path === "src/c.js")
      ?.reasons.some((text) => text.includes("literal import at line")),
  );
});

test("Python aliases, multiline from imports, packages, src layout, relative imports and cycles", async (t) => {
  const root = await fixture(t, {
    "pkg/__init__.py": "from . import a\n",
    "pkg/a.py": "from .b import (\n validation as validate,\n)\n",
    "pkg/b.py": "from . import a\nvalidation = 1\n",
    "main.py":
      "import pkg.a as module, pkg.b\nfrom pkg import a as aliased\nfrom service import execute\n",
    "src/service.py": "from pkg.a import validate\n",
    "noise.py": '# import pkg.a\ntext = "from pkg.b import validation"\n',
    "pkg/sub/consumer.py": "from ..a import validation\nfrom ....escape import bad\n",
  });
  const report = await query({ ...request(root), paths: ["pkg/b.py"] });
  assertResponse(report);
  assert.ok(
    report.graph.edges.some(
      (edge) => edge.from === "pkg/a.py" && edge.to === "pkg/b.py",
    ),
  );
  assert.ok(
    report.graph.edges.some(
      (edge) => edge.from === "pkg/b.py" && edge.to === "pkg/a.py",
    ),
  );
  assert.ok(
    report.graph.edges.some(
      (edge) => edge.from === "main.py" && edge.to === "src/service.py",
    ),
  );
  assert.ok(
    report.graph.edges.some(
      (edge) => edge.from === "main.py" && edge.to === "pkg/__init__.py",
    ),
  );
  assert.ok(
    report.graph.edges.some(
      (edge) => edge.from === "pkg/sub/consumer.py" && edge.to === "pkg/a.py",
    ),
  );
  assert.ok(!report.graph.edges.some((edge) => edge.from === "noise.py"));
  assert.ok(report.graph.impacted.includes("src/service.py"));
  assert.ok(report.graph.impacted.includes("pkg/sub/consumer.py"));
  assert.ok(report.graph.cycles.length > 0);
  assert.ok(report.diagnostics.some((text) => text.includes("escape")));
});

test("bounded transitive reverse impact and traversal diagnostics", async (t) => {
  const root = await fixture(t, {
    "a.js": "export const a = 1",
    "b.js": 'import "./a"',
    "c.js": 'import "./b"',
    "d.js": 'import "./c"',
  });
  for (const depth of [0, 1, 2, 3]) {
    const report = await query({
      ...request(root),
      paths: ["a.js"],
      budget: { maxDepth: depth },
    });
    assert.deepEqual(report.graph.impacted, ["b.js", "c.js", "d.js"].slice(0, depth));
    if (depth < 3)
      assert.ok(
        report.diagnostics.some((text) => text.includes("Reverse impact truncated")),
      );
  }
});

test("stack signals from dependencies, paths and Python content", async (t) => {
  const root = await fixture(t, {
    "package.json": JSON.stringify({
      dependencies: { react: "*", next: "*", "@modelcontextprotocol/sdk": "*" },
      devDependencies: { typescript: "*" },
    }),
    "app/form.tsx": "export const Form = () => <form />",
    "pyproject.toml": '[project]\ndependencies = ["fastapi>=0.1", "mcp"]\n',
    "server.py": "from mcp.server.fastmcp import FastMCP\n",
    "next.config.js": "export default {}",
  });
  const report = await query(request(root));
  assert.deepEqual(report.signals, [
    "fastapi",
    "javascript",
    "mcp",
    "nextjs",
    "python",
    "react",
    "tsx",
    "typescript",
  ]);
  assert.ok(
    report.diagnostics.some((text) => text.includes("possible external import")),
  );
});

test("profiles vary priority and excerpt detail, lexical rank and deterministic ties", async (t) => {
  const root = await fixture(t, {
    "README.md": "Project notes",
    "package.json": "{}",
    "src/index.ts": 'import "./central";',
    "src/central.ts": "export const validation = 1;\n".repeat(200),
    "test/validation.test.ts": 'import "../src/central";',
    "a.txt": "equal",
    "b.txt": "equal",
  });
  const reports = await Promise.all(
    PROFILES.map((profile) => query({ ...request(root), profile })),
  );
  assert.equal(reports[0]?.files[0]?.path, "README.md");
  assert.equal(reports[1]?.files[0]?.path, "src/index.ts");
  assert.equal(reports[2]?.files[0]?.path, "src/central.ts");
  assert.equal(reports[3]?.files[0]?.path, "test/validation.test.ts");
  assert.ok(reports[0]?.files.every((file) => file.excerpt === undefined));
  assert.ok(
    (reports[2]?.files.find((file) => file.path === "src/central.ts")?.excerpt
      ?.length ?? 0) >
      (reports[1]?.files.find((file) => file.path === "src/central.ts")?.excerpt
        ?.length ?? 0),
  );
  for (const report of reports) {
    assertResponse(report);
    assert.ok(
      report.files.findIndex((file) => file.path === "a.txt") <
        report.files.findIndex((file) => file.path === "b.txt"),
    );
  }
});

test("whole-output budget includes digest and newline, stable ordering and content snapshot", async (t) => {
  const entries = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [
      `file-${String(i).padStart(2, "0")}.ts`,
      `import "./file-${String((i + 1) % 40).padStart(2, "0")}";\n// ${"\u00e9\u4e2d".repeat(1000)}`,
    ]),
  );
  const root = await fixture(t, entries);
  const reordered = await fixture(
    t,
    Object.fromEntries(Object.entries(entries).reverse()),
  );
  for (const maxBytes of [1024, 1025, 1500, 2048, 8192, 24000]) {
    const input = {
      ...request(root),
      profile: "implementation",
      paths: ["file-00.ts"],
      budget: { maxFiles: 12, maxBytes, maxDepth: 2 },
    };
    const report = await query(input);
    assertResponse(report, maxBytes);
    assert.ok(report.files.length <= 12);
    assert.equal(report.stats.truncated, true);
    assert.deepEqual(await query(input), report);
    assert.deepEqual(await query({ ...input, root: reordered }), report);
  }
  const before = await query(request(root));
  await writeFile(path.join(root, "file-39.ts"), "export const changed = true;");
  const after = await query(request(root));
  assert.notEqual(before.snapshot, after.snapshot);
  assert.notEqual(before.digest, after.digest);
  assert.equal(
    canonicalJson({ z: [{ b: 2, a: 1 }], "2": 2, "10": 10 }),
    '{"10":10,"2":2,"z":[{"a":1,"b":2}]}',
  );
  assert.equal(
    digest({ b: 2, a: { d: 4, c: 3 } }),
    digest({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("secret files, external and internal symlinks, binary, oversized and nonregular input", async (t) => {
  const outside = await fixture(t, { "outside.ts": "EXTERNAL_SECRET" });
  const root = await fixture(t, {
    ".env": "ENV_SECRET",
    ".env.local": "ENV_SECRET",
    "credentials.json": '"CREDENTIAL_SECRET"',
    "keys/key.ts": "KEY_SECRET",
    ".aws/config.json": "AWS_SECRET",
    id_ed25519: "SSH_SECRET",
    "private.pem": "PEM_SECRET",
    ".npmrc": "NPM_SECRET",
    "node_modules/dependency/index.js": "DEPENDENCY_SECRET",
    ".git/config": "GIT_SECRET",
    "binary.ts": Buffer.from([0, 1, 2]),
    "invalid.ts": Buffer.from([0xff, 0xfe]),
    "huge.ts": "x".repeat(LIMITS.maxFileBytes + 1),
    "normal.ts":
      'const password = "DO_NOT_LEAK"; const token = "abc"; export const safe = true;',
    "safe.ts":
      'import "./outside"; import "./linked/outside"; import "../escape"; export const safe = 1;',
  });
  await symlink(path.join(outside, "outside.ts"), path.join(root, "outside.ts"));
  await symlink(outside, path.join(root, "linked"));
  await symlink(path.join(root, "safe.ts"), path.join(root, "internal.ts"));
  const report = await query({
    ...request(root),
    profile: "implementation",
    paths: ["outside.ts", "linked/outside.ts", ".env", "missing.ts"],
  });
  assertResponse(report);
  assert.deepEqual(report.graph.nodes, ["normal.ts", "safe.ts"]);
  const serialized = canonicalJson(report);
  for (const secret of [
    "EXTERNAL_SECRET",
    "ENV_SECRET",
    "CREDENTIAL_SECRET",
    "KEY_SECRET",
    "AWS_SECRET",
    "DO_NOT_LEAK",
    "DEPENDENCY_SECRET",
  ])
    assert.ok(!serialized.includes(secret), secret);
  assert.ok(serialized.includes("REDACTED"));
  assert.ok(report.diagnostics.some((text) => text.includes("Symlink")));
  assert.ok(report.diagnostics.some((text) => text.includes("Binary")));
  assert.ok(report.diagnostics.some((text) => text.includes("Oversized")));
  assert.equal(report.graph.edges.length, 0);
  await assert.rejects(query(request(path.join(root, "safe.ts"))));
});

test("Git working tree includes current untracked content without executing hooks or filters", async (t) => {
  const root = await fixture(t, {
    "a.ts": "export const a = 1;",
    ".gitignore": "ignored.ts\n",
    "ignored.ts": "export const current = true;",
  });
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  await writeFile(
    path.join(root, ".git", "config"),
    '[core]\n repositoryformatversion = 0\n bare = false\n[core]\n fsmonitor = "touch SHOULD_NOT_EXIST"\n',
  );
  const before = await readdir(root);
  const contents = await readFile(path.join(root, "a.ts"));
  const report = await query(request(root));
  assert.deepEqual(await readdir(root), before);
  assert.deepEqual(await readFile(path.join(root, "a.ts")), contents);
  assert.ok(report.files.some((file) => file.path === "ignored.ts"));
  assert.equal(report.stats.scannedFiles, 2);
});

test("analysis limits and diagnostic suppression remain bounded", async (t) => {
  const root = await fixture(t, {
    "imports.ts": Array.from(
      { length: 400 },
      (_, i) => `import "./missing-${i}";`,
    ).join("\n"),
    [`${"deep/".repeat(34)}file.ts`]: "export const unreachable = 1;",
  });
  const report = await query({ ...request(root), budget: { maxBytes: 1024 } });
  assertResponse(report, 1024);
  assert.ok(report.stats.truncated);
  assert.ok(report.diagnostics.some((text) => /truncat|limit/i.test(text)));
});

test("hard file and total-source-byte limits bound actual reads", async (t) => {
  const root = await fixture(
    t,
    Object.fromEntries(
      Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => [
        `file-${String(i).padStart(4, "0")}.txt`,
        "bounded",
      ]),
    ),
  );
  const diagnostics = new Diagnostics();
  const source = loadSource(root, diagnostics);
  assert.equal(source.files.length, LIMITS.maxFiles);
  assert.equal(source.files.at(-1)?.path, "file-1999.txt");
  assert.ok(diagnostics.truncated);
  const large = await fixture(
    t,
    Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [
        `file-${String(i).padStart(2, "0")}.txt`,
        "x".repeat(LIMITS.maxFileBytes),
      ]),
    ),
  );
  const bounded = loadSource(large, new Diagnostics());
  assert.equal(bounded.files.length, 64);
  assert.equal(
    bounded.files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0),
    LIMITS.maxSourceBytes,
  );
});

test("dense graph output is bounded without per-edge whole-response serialization", {
  timeout: 10000,
}, () => {
  const nodes = Array.from({ length: 200 }, (_, i) => `file-${i}.ts`).sort();
  const edges: QueryResponse["graph"]["edges"] = nodes.flatMap((from) =>
    nodes.slice(0, 100).map((to) => ({ from, to, kind: "imports" as const })),
  );
  const report = finalize(
    {
      protocolVersion: "1.0",
      profile: "architecture",
      snapshot: "a".repeat(64),
      signals: ["typescript"],
      files: nodes.map((file) => ({
        path: file,
        language: "typescript",
        score: 1,
        reasons: ["test evidence"],
      })),
      graph: { nodes, edges, cycles: [], impacted: [] },
      diagnostics: [],
      stats: { scannedFiles: 200, selectedFiles: 200, truncated: false },
      digest: "",
    },
    1024,
  );
  assertResponse(report, 1024);
  assert.ok(report.stats.truncated);
});

test("empty roots, unavailable seeds, zero-depth self-cycles and metadata-only hints", async (t) => {
  const empty = await fixture(t, {});
  const report = await query({
    ...request(empty),
    paths: ["missing.ts"],
    budget: { maxBytes: 1024 },
  });
  assertResponse(report, 1024);
  assert.equal(report.stats.scannedFiles, 0);
  assert.deepEqual(report.files, []);
  assert.ok(report.diagnostics.some((text) => text.includes("Seed unavailable")));
  const root = await fixture(t, {
    "pyproject.toml": '[project]\ndependencies = ["mcp>=1", "fastapi"]',
    "self.ts": 'import "./self"',
  });
  const noDepth = await query({
    ...request(root),
    paths: ["self.ts"],
    budget: { maxDepth: 0 },
  });
  assert.deepEqual(noDepth.graph.cycles, []);
  assert.deepEqual(noDepth.graph.impacted, []);
  assert.ok(
    noDepth.signals.includes("python") &&
      noDepth.signals.includes("mcp") &&
      noDepth.signals.includes("fastapi"),
  );
  const depth = await query({ ...request(root), budget: { maxDepth: 1 } });
  assert.deepEqual(depth.graph.cycles, [["self.ts", "self.ts"]]);
});

test("excluded content cannot affect snapshot; accepted redacted content changes do", async (t) => {
  const root = await fixture(t, {
    ".env": "SECRET=before",
    "a.ts": 'const password = "before"; export const a = 1;',
  });
  const before = await query({ ...request(root), profile: "implementation" });
  await writeFile(path.join(root, ".env"), "SECRET=after");
  assert.deepEqual(
    await query({ ...request(root), profile: "implementation" }),
    before,
  );
  await writeFile(
    path.join(root, "a.ts"),
    'const password = "after"; export const a = 1;',
  );
  const after = await query({ ...request(root), profile: "implementation" });
  assert.notEqual(after.snapshot, before.snapshot);
  assert.deepEqual(after.files, before.files);
});

test("tooling state and retained worktrees are excluded at every level", async (t) => {
  const metadataRoots = [
    ".codepatrol/v1",
    "nested/.codepatrol/v1",
    ".memorypatrol/v1",
    "nested/.memorypatrol/v1",
  ];
  const root = await fixture(t, {
    "src/current.ts": "export const validation = true;",
    ...Object.fromEntries(
      metadataRoots.flatMap((directory) => [
        [`${directory}/state.json`, '{"status":"pending"}'],
        [
          `${directory}/workspaces/id/react.tsx`,
          'import React from "react"; export const Form = () => <form />;',
        ],
      ]),
    ),
  });
  const before = await query(request(root));
  assertResponse(before);
  assert.deepEqual(
    before.files.map((file) => file.path),
    ["src/current.ts"],
  );
  assert.deepEqual(before.signals, ["typescript"]);
  assert.equal(before.stats.scannedFiles, 1);
  assert.deepEqual(before.graph.nodes, ["src/current.ts"]);

  for (const directory of metadataRoots) {
    await writeFile(
      path.join(root, directory, "state.json"),
      '{"status":"passed","history":[1,2,3]}',
    );
    await writeFile(
      path.join(root, directory, "workspaces/id/react.tsx"),
      'import next from "next"; export const Form = () => <main />;',
    );
    await writeFile(
      path.join(root, directory, "workspaces/id/server.py"),
      "from mcp.server.fastmcp import FastMCP\n",
    );
  }
  const after = await query(request(root));
  assert.equal(after.snapshot, before.snapshot);
  assert.deepEqual(after, before);
});

test("schemas mirror the closed protocol fields, profiles, defaults and safety patterns", async (t) => {
  const requestSchema = JSON.parse(
    await readFile(
      new URL("../../schemas/query-request.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const responseSchema = JSON.parse(
    await readFile(
      new URL("../../schemas/query-response.schema.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(requestSchema.additionalProperties, false);
  assert.equal(requestSchema.$id, "urn:contextpatrol:query-request:1.0");
  assert.equal(requestSchema.properties.protocolVersion.const, "1.0");
  assert.deepEqual(requestSchema.required, ["protocolVersion", "root", "task"]);
  assert.deepEqual(Object.keys(requestSchema.properties).sort(), [
    "budget",
    "paths",
    "profile",
    "protocolVersion",
    "root",
    "task",
  ]);
  assert.deepEqual(requestSchema.properties.profile.enum, PROFILES);
  const rootPattern = new RegExp(requestSchema.properties.root.pattern);
  assert.ok(rootPattern.test("/repo"));
  assert.ok(!rootPattern.test("relative") && !rootPattern.test("/repo\0"));
  const pattern = new RegExp(requestSchema.properties.paths.items.pattern);
  for (const good of ["a", "src/file.ts", ".github/config.json"])
    assert.ok(pattern.test(good), good);
  for (const bad of [
    "../a",
    "a/../b",
    "a//b",
    "./a",
    "/a",
    "a/",
    "C:/a",
    "a\\b",
    "a\0",
    "*.ts",
  ])
    assert.ok(!pattern.test(bad), bad);
  const root = await fixture(t, {
    "a.ts": 'import "./b";',
    "b.ts": "export const b = 1;",
  });
  const report = await query({ ...request(root), profile: "implementation" });
  assert.equal(responseSchema.additionalProperties, false);
  assert.equal(responseSchema.$id, "urn:contextpatrol:query-response:1.0");
  assert.equal(responseSchema.properties.protocolVersion.const, "1.0");
  assert.deepEqual(responseSchema.required.sort(), Object.keys(report).sort());
  assert.deepEqual(
    Object.keys(responseSchema.properties).sort(),
    Object.keys(report).sort(),
  );
  assert.deepEqual(
    Object.keys(responseSchema.properties.graph.properties).sort(),
    Object.keys(report.graph).sort(),
  );
  assert.deepEqual(
    Object.keys(responseSchema.properties.stats.properties).sort(),
    Object.keys(report.stats).sort(),
  );
  assert.deepEqual(
    Object.keys(responseSchema.properties.files.items.properties).sort(),
    Object.keys(report.files[0] ?? {}).sort(),
  );
  assert.equal(
    responseSchema.properties.graph.properties.edges.items.properties.kind.const,
    "imports",
  );
  const effective = parseQuery(request(root));
  for (const key of ["maxBytes", "maxFiles", "maxDepth"] as const) {
    const constraint = requestSchema.properties.budget.properties[key];
    assert.ok(
      effective.budget[key] >= constraint.minimum &&
        effective.budget[key] <= constraint.maximum,
    );
    assert.equal(
      parseQuery({ protocolVersion: "1.0", root, task: "test" }).budget[key],
      constraint.default,
    );
  }
});

test("type imports and JSX source mappings are dependency evidence", async (t) => {
  const root = await fixture(t, {
    "types.ts": "export interface Value { value: number }",
    "component.tsx": "export const Component = () => <div />;",
    "consumer.ts":
      'type Value = import("./types.js").Value; import { Component } from "./component.jsx";',
  });
  const report = await query({ ...request(root), paths: ["types.ts"] });
  assert.deepEqual(report.graph.edges, [
    { from: "consumer.ts", to: "component.tsx", kind: "imports" },
    { from: "consumer.ts", to: "types.ts", kind: "imports" },
  ]);
  assert.deepEqual(report.graph.impacted, ["consumer.ts"]);
});

test("credential redaction handles escaped quotes, multiline literals and private keys", () => {
  for (const text of [
    'const password = "first\\"PRIVATE_VALUE";',
    "const secret = 'first\\'PRIVATE_VALUE';",
    "const token = `first\nPRIVATE_VALUE`;",
    'const api_key = "first\nPRIVATE_VALUE";',
    'const authorization = "PRIVATE_VALUE',
    "-----BEGIN OPENSSH PRIVATE KEY-----\nPRIVATE_VALUE\n-----END OPENSSH PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----\nPRIVATE_VALUE",
  ]) {
    const result = redact(text);
    assert.ok(!result.includes("PRIVATE_VALUE"), result);
    assert.ok(result.includes("REDACTED"));
  }
});
