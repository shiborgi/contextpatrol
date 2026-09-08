import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/cli.js";
import { digest } from "../src/index.js";

const bin = fileURLToPath(new URL("../../bin/contextpatrol.js", import.meta.url));
test("CLI stdin and input-file transport, info/help/version", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "contextpatrol-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "a.ts"), "export const validation = true;");
  const input = JSON.stringify({
    protocolVersion: "1.0",
    root,
    task: "validation",
    budget: { maxBytes: 1024 },
  });
  const stdin = spawnSync(process.execPath, [bin, "query"], {
    input,
    encoding: "utf8",
  });
  assert.equal(stdin.status, 0, stdin.stderr);
  assert.equal(stdin.stderr, "");
  assert.ok(Buffer.byteLength(stdin.stdout) <= 1024);
  assert.equal(stdin.stdout.split("\n").length, 2);
  const { digest: hash, ...payload } = JSON.parse(stdin.stdout);
  assert.equal(hash, digest(payload));
  const file = path.join(root, "query.input");
  await writeFile(file, input);
  const fromFile = spawnSync(process.execPath, [bin, "query", "--input", file], {
    encoding: "utf8",
  });
  assert.equal(fromFile.status, 0, fromFile.stderr);
  const explicit = spawnSync(process.execPath, [bin, "query", "--input", "-"], {
    input,
    encoding: "utf8",
  });
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.equal(fromFile.stdout, explicit.stdout);
  for (const arg of ["info", "--help", "help", "--version", "version"]) {
    const result = spawnSync(process.execPath, [bin, arg], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("1.0"));
  }
});

test("malformed, unsupported-version, oversized, invalid UTF-8 and invalid argv fail without stdout", async () => {
  for (const input of [
    "",
    "{",
    "{}{}",
    "null",
    "[]",
    '{"schemaVersion":1}',
    '{"protocolVersion":"1.1"}',
    " ".repeat(65537),
    Buffer.from([0xff]),
  ]) {
    const result = spawnSync(process.execPath, [bin, "query"], {
      input,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^contextpatrol:/);
  }
  for (const args of [
    [],
    ["analyze"],
    ["query", "--json"],
    ["query", "--input"],
    ["query", "--input", "-", "extra"],
    ["info", "extra"],
    ["query", "--input", "/missing/contextpatrol.json"],
  ]) {
    const result = await runCli(args, Readable.from([]));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
  }
  let reads = 0;
  async function* oversized() {
    reads++;
    yield " ".repeat(65537);
    reads++;
    yield "ignored";
  }
  assert.equal((await runCli(["query"], oversized())).exitCode, 1);
  assert.equal(reads, 1);
});

test("CLI input-file limits reject symlinks, directories, oversized files and FIFOs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "contextpatrol-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "input.json");
  await writeFile(file, " ".repeat(65537));
  const link = path.join(root, "link.json");
  await symlink(file, link);
  const fifo = path.join(root, "fifo.json");
  assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
  for (const input of [root, file, link, fifo]) {
    const result = spawnSync(process.execPath, [bin, "query", "--input", input], {
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
  }
});
