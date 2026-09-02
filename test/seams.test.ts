import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { queryContext } from "../src/analyze.js";
import { SOURCE_EXTENSIONS } from "../src/constants.js";
import { IndexStore } from "../src/index-store.js";
import { parseFile } from "../src/parser.js";
import { resolveImport } from "../src/relations.js";
import { allowedPath, redact } from "../src/source.js";
import type { QueryRequest, SourceFile } from "../src/types.js";

const request: QueryRequest = {
  schemaVersion: 1,
  workspace: "/tmp/project",
  query: "token",
  facets: ["structure"],
  maxOutputBytes: 2_048,
  target: { kind: "working-tree" },
};

test("source policy and redaction are directly testable", () => {
  assert.equal(allowedPath("src/service.ts", request), true);
  assert.equal(allowedPath("node_modules/pkg/index.js", request), false);
  assert.equal(allowedPath(".env", request), false);
  assert.equal(redact("token: supersecretvalue"), "token: [REDACTED]");
  assert.equal(
    redact("-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----"),
    "[REDACTED]",
  );
});

test("ranking does not require an FTS match to select a scored file", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-ranking-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    writeFileSync(path.join(workspace, "service.ts"), "export function service() {}\n");
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const report = await queryContext({ ...request, workspace, query: "service" });
    assert.ok(report.files.some((file) => file.path === "service.ts"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("import candidates use the shared extension table", () => {
  assert.equal(SOURCE_EXTENSIONS.has(".ts"), true);
  assert.equal(
    resolveImport("src/main.ts", "./helper", new Set(["src/helper.ts"])),
    "src/helper.ts",
  );
});

test("parser returns TypeScript symbols, imports, and terms", async () => {
  const file: SourceFile = {
    path: "service.ts",
    content:
      "import { helper } from './helper';\nexport function service() { return helper(); }\n",
    hash: "sha256:test",
    language: "ts",
    lines: 2,
  };
  const facts = await parseFile(file);
  assert.ok(facts.symbols.some((symbol) => symbol.name === "service"));
  assert.deepEqual(facts.imports, ["./helper"]);
  assert.ok(facts.terms.includes("service"));
});

test("index store returns facts after a put", () => {
  const cache = mkdtempSync(path.join(tmpdir(), "contextpatrol-cache-"));
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cache;
  const store = new IndexStore("/tmp/contextpatrol-test-root");
  const facts = { language: "ts", symbols: [], imports: [], terms: ["service"] };
  try {
    store.put("sha256:file", facts);
    assert.deepEqual(store.get("sha256:file"), facts);
  } finally {
    store.close();
    if (previous === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous;
    rmSync(cache, { recursive: true, force: true });
  }
});

test("query reports BUDGET_TOO_SMALL when the envelope cannot fit", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-budget-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    writeFileSync(
      path.join(workspace, "large.ts"),
      Array.from(
        { length: 200 },
        (_, index) => `export const value${index} = ${index};`,
      ).join("\n"),
    );
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const result = await queryContext({
      ...request,
      workspace,
      facets: ["structure", "symbols", "relations", "source", "tests"],
      maxOutputBytes: 1_024,
    });
    assert.equal(result.budget.limited, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("CSS and MDX are eligible source; generated frontend trees are denied", () => {
  assert.equal(SOURCE_EXTENSIONS.has(".css"), true);
  assert.equal(SOURCE_EXTENSIONS.has(".mdx"), true);
  assert.equal(allowedPath("styles.css", request), true);
  assert.equal(allowedPath("page.mdx", request), true);
  assert.equal(allowedPath(".next/generated.ts", request), false);
  assert.equal(allowedPath("coverage/out.ts", request), false);
  assert.equal(allowedPath(".turbo/cache.ts", request), false);
  assert.equal(allowedPath("storybook-static/preview.js", request), false);
  assert.equal(allowedPath("src/build/util.ts", request), true);
});

test("relative CSS imports resolve through the shared extension table", () => {
  assert.equal(
    resolveImport("src/main.ts", "./styles.css", new Set(["src/styles.css"])),
    "src/styles.css",
  );
});

test("function-valued lexical declarations appear as symbols", async () => {
  const file: SourceFile = {
    path: "screen.tsx",
    content:
      "export const Screen = () => null;\nconst helper = function () {};\nconst unused = 1;\n",
    hash: "sha256:test",
    language: "tsx",
    lines: 3,
  };
  const facts = await parseFile(file);
  const screen = facts.symbols.find((symbol) => symbol.name === "Screen");
  assert.ok(screen);
  assert.equal(screen.exported, true);
  assert.ok(facts.symbols.some((symbol) => symbol.name === "helper"));
  assert.ok(!facts.symbols.some((symbol) => symbol.name === "unused"));
});

test("path aliases resolve through analyzed tsconfig paths", () => {
  assert.equal(
    resolveImport("src/app.ts", "@/lib/format", new Set(["lib/format.ts"]), [
      { pattern: "@/*", target: "./*", baseDir: "" },
    ]),
    "lib/format.ts",
  );
  assert.equal(
    resolveImport("src/app.ts", "react", new Set(["react"]), [
      { pattern: "@/*", target: "./*", baseDir: "" },
    ]),
    undefined,
  );
});
