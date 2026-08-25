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
