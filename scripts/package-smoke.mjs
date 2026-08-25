import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const temporary = await mkdtemp(
  path.join(os.tmpdir(), "contextpatrol-package-"),
);
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
  const packed = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", temporary]),
  );
  const archive = path.join(temporary, packed[0].filename);
  const installRoot = path.join(temporary, "installed");
  run("npm", [
    "install",
    "--prefix",
    installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    archive,
  ]);
  const executable = path.join(
    installRoot,
    "node_modules",
    ".bin",
    "contextpatrol",
  );
  assert.equal(
    JSON.parse(run(executable, ["info"])).provider.name,
    "contextpatrol",
  );
  const workspace = path.join(temporary, "workspace");
  run("git", ["init", "-q", "-b", "main", workspace]);
  await writeFile(
    path.join(workspace, "example.ts"),
    "export function greet(name: string) { return `Hello ${name}`; }\n",
  );
  run("git", ["-C", workspace, "add", "."]);
  run("git", [
    "-C",
    workspace,
    "-c",
    "user.name=Package Smoke",
    "-c",
    "user.email=package@example.com",
    "commit",
    "-qm",
    "fixture",
  ]);
  const report = JSON.parse(
    run(executable, ["query", "--input", "-"], {
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
  run(
    process.execPath,
    ["--input-type=module", "--eval", "import('contextpatrol')"],
    {
      cwd: installRoot,
    },
  );
  process.stdout.write("packed install smoke passed\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
