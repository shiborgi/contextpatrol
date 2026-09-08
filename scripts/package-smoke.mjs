import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temporary = await mkdtemp(path.join(os.tmpdir(), "contextpatrol-package-"));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 1048576,
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
try {
  const [packed] = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary]),
  );
  assert.equal(packed.version, "1.0.0");
  assert.ok(packed.files.some((file) => file.path === "docs/protocol.md"));
  assert.ok(
    packed.files.some((file) => file.path === "schemas/query-response.schema.json"),
  );
  assert.ok(
    !packed.files.some((file) =>
      /(?:dist\/test\/|index-store|run-context|section-digest)/.test(file.path),
    ),
  );
  const installRoot = path.join(temporary, "installed");
  await mkdir(installRoot);
  run("npm", [
    "install",
    "--prefix",
    installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    path.join(temporary, packed.filename),
  ]);
  const executable = path.join(installRoot, "node_modules", ".bin", "contextpatrol");
  const info = JSON.parse(run(executable, ["info"]));
  assert.equal(info.name, "contextpatrol");
  assert.equal(info.version, "1.0.0");
  assert.equal(info.protocolVersion, "1.0");
  const workspace = path.join(temporary, "workspace");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "base.py"), "from consumer import result\n");
  await writeFile(
    path.join(workspace, "consumer.py"),
    "from base import value\nresult = 1\n",
  );
  await writeFile(path.join(workspace, "base.ts"), "export const value = 1;");
  await writeFile(
    path.join(workspace, "consumer.ts"),
    'import { value } from "./base.js";',
  );
  const input = {
    protocolVersion: "1.0",
    root: workspace,
    task: "change value",
    profile: "implementation",
    paths: ["base.py", "base.ts"],
    budget: { maxBytes: 8192, maxDepth: 3 },
  };
  const stdout = run(executable, ["query"], { input: JSON.stringify(input) });
  assert.ok(Buffer.byteLength(stdout) <= 8192);
  const { digest, ...payload } = JSON.parse(stdout);
  assert.equal(digest, createHash("sha256").update(canonical(payload)).digest("hex"));
  assert.deepEqual(payload.graph.impacted, ["consumer.py", "consumer.ts"]);
  assert.ok(payload.graph.cycles.length > 0);
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import assert from 'node:assert/strict'; import {PROTOCOL_VERSION, query, VERSION} from 'contextpatrol'; assert.equal(VERSION,'1.0.0'); assert.equal(PROTOCOL_VERSION,'1.0'); const report = await query(${JSON.stringify(input)}); assert.equal(report.protocolVersion,PROTOCOL_VERSION); assert.equal(report.digest,${JSON.stringify(digest)});`,
    ],
    { cwd: installRoot },
  );
  const unsupported = spawnSync(executable, ["query"], {
    input: '{"protocolVersion":"1.1"}',
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(unsupported.status, 1);
  assert.equal(unsupported.stdout, "");
  process.stdout.write(
    "Patrol Protocol 1.0 packed install, library, JS/TS and Python CLI smoke passed\n",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
