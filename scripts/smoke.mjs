import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(root, "bin", "contextpatrol.js");
const temporary = await mkdtemp(path.join(os.tmpdir(), "contextpatrol-smoke-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

try {
  const info = JSON.parse(run(process.execPath, [binary, "info"]));
  assert.equal(info.provider.name, "contextpatrol");
  const workspace = path.join(temporary, "workspace");
  run("git", ["init", "-q", "-b", "main", workspace]);
  await writeFile(
    path.join(workspace, "example.ts"),
    'export function greet(name: string) { return "Hello " + name; }\n',
  );
  run("git", ["-C", workspace, "add", "."]);
  run("git", [
    "-C",
    workspace,
    "-c",
    "user.name=Smoke",
    "-c",
    "user.email=smoke@example.com",
    "commit",
    "-qm",
    "fixture",
  ]);
  const report = JSON.parse(
    run(process.execPath, [binary, "query", "--input", "-"], {
      input: JSON.stringify({
        schemaVersion: 1,
        workspace,
        query: "greet",
        facets: ["symbols", "source"],
        maxOutputBytes: 8_192,
        target: { kind: "working-tree" },
      }),
    }),
  );
  assert.equal(report.provider.name, "contextpatrol");
  assert.ok(report.budget.outputBytes <= 8_192);
  assert.ok(report.symbols.some((symbol) => symbol.name === "greet"));
  process.stdout.write("contextpatrol smoke passed\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
