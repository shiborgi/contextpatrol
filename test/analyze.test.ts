import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { queryContext } from "../src/analyze.js";

test("query uses indexed facts and honors exact output bytes", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    writeFileSync(
      path.join(workspace, "service.ts"),
      "export function authenticate(token: string) { return token.length > 0; }\n",
    );
    writeFileSync(
      path.join(workspace, "service.test.ts"),
      "import { authenticate } from './service';\nvoid authenticate('token');\n",
    );
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const request = {
      schemaVersion: 1 as const,
      workspace,
      query: "authenticate token",
      facets: ["structure", "symbols", "relations", "source", "tests"] as const,
      maxOutputBytes: 8_192,
      target: { kind: "working-tree" as const },
    };
    const first = await queryContext({
      ...request,
      facets: [...request.facets],
    });
    const second = await queryContext({
      ...request,
      facets: [...request.facets],
    });
    assert.equal(first.reportDigest, second.reportDigest);
    assert.ok(first.budget.outputBytes <= request.maxOutputBytes);
    assert.ok(first.symbols.some((symbol) => symbol.name === "authenticate"));
    assert.deepEqual(first.relations, [
      { kind: "imports", from: "service.test.ts", to: "service.ts" },
    ]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("body-only call sites rank above unrelated files", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    writeFileSync(path.join(workspace, "unrelated.ts"), "export function noop() {}\n");
    writeFileSync(path.join(workspace, "caller.ts"), "void uniqueidentifier();\n");
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const report = await queryContext({
      schemaVersion: 1,
      workspace,
      query: "uniqueidentifier",
      facets: ["structure"],
      maxOutputBytes: 8_192,
      target: { kind: "working-tree" },
    });
    const caller = report.files.find((entry) => entry.path === "caller.ts");
    const unrelated = report.files.find((entry) => entry.path === "unrelated.ts");
    assert.ok(caller);
    assert.ok(unrelated);
    assert.ok(caller.score > unrelated.score);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("limited baseline query keeps a changed path", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    const pad = "export const value = 'x'.repeat(80);\n".repeat(40);
    for (const name of ["alpha.ts", "beta.ts", "gamma.ts", "delta.ts"]) {
      writeFileSync(
        path.join(workspace, name),
        `export function ${name.slice(0, -3)}() {}\n${pad}`,
      );
    }
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "base"]);
    const baseline = execFileSync("git", ["-C", workspace, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    writeFileSync(
      path.join(workspace, "changed.ts"),
      "export function changed() { return 1; }\n",
    );
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "change"]);
    const head = execFileSync("git", ["-C", workspace, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const report = await queryContext({
      schemaVersion: 1,
      workspace,
      query: "alpha beta gamma",
      facets: ["structure", "symbols", "relations", "source", "changes", "tests"],
      maxOutputBytes: 2_048,
      target: { kind: "commit", oid: head },
      baseline: { oid: baseline },
    });
    assert.equal(report.budget.limited, true);
    assert.ok(report.changes.some((entry) => entry.path === "changed.ts"));
    assert.equal(
      report.changes.length === 0 &&
        report.files.length === 0 &&
        report.relations.length === 0,
      false,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
