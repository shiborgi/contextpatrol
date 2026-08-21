import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/cli.js";
import { canonicalJsonLine } from "../src/hash.js";

function stdinOf(text: string): () => Promise<Buffer> {
  return async () => Buffer.from(text, "utf8");
}

test("protocol prints a descriptor and exits 0", async () => {
  const result = await runCli(["node", "contextpatrol", "protocol"], stdinOf(""));
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.provider, "contextpatrol");
  assert.equal(result.stderr, "");
  assert.deepEqual(parsed.supportedProtocolVersions, [1]);
  assert.equal(result.stdout, canonicalJsonLine(parsed));
});

test("protocol version negotiation rejects unsupported and conflicting values", async () => {
  const unsupported = await runCli(
    ["node", "contextpatrol", "pack", "--protocol-version", "2", "--request", "-"],
    stdinOf(
      JSON.stringify({
        workspace: "/repo",
        intent: "x",
        focus: ["symbols"],
        tokenBudget: 800,
      }),
    ),
  );
  assert.equal(unsupported.exitCode, 2);
  assert.deepEqual(JSON.parse(unsupported.stderr), {
    error: "PROTOCOL_UNSUPPORTED",
    message: "requested protocol version is unsupported",
    requestedProtocolVersion: 2,
    supportedProtocolVersions: [1],
  });

  const conflicting = await runCli(
    ["node", "contextpatrol", "pack", "--protocol-version", "2", "--request", "-"],
    stdinOf(
      JSON.stringify({
        protocolVersion: 1,
        workspace: "/repo",
        intent: "x",
        focus: ["symbols"],
        tokenBudget: 800,
      }),
    ),
  );
  assert.equal(conflicting.exitCode, 2);
  assert.equal(JSON.parse(conflicting.stderr).error, "PROTOCOL_UNSUPPORTED");
});

test("unknown command exits 2", async () => {
  const result = await runCli(["node", "contextpatrol", "bogus"], stdinOf(""));
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
});

test("pack with invalid JSON exits 2 with empty stdout", async () => {
  const result = await runCli(
    ["node", "contextpatrol", "pack", "--request", "-"],
    stdinOf("{ not json"),
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  const err = JSON.parse(result.stderr);
  assert.equal(err.error, "REQUEST_INVALID");
});

test("pack rejects unknown fields", async () => {
  const body = JSON.stringify({
    protocolVersion: 1,
    workspace: "/repo",
    intent: "x",
    focus: ["symbols"],
    tokenBudget: 800,
    stage: "plan",
  });
  const result = await runCli(
    ["node", "contextpatrol", "pack", "--request", "-"],
    stdinOf(body),
  );
  assert.equal(result.exitCode, 2);
  const err = JSON.parse(result.stderr);
  assert.equal(err.error, "REQUEST_INVALID");
});

test("pack errors on non-repository workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "contextpatrol-cli-"));
  try {
    const body = JSON.stringify({
      protocolVersion: 1,
      workspace: dir,
      intent: "x",
      focus: ["symbols"],
      tokenBudget: 800,
    });
    const result = await runCli(
      ["node", "contextpatrol", "pack", "--request", "-"],
      stdinOf(body),
    );
    assert.equal(result.exitCode, 1);
    const err = JSON.parse(result.stderr);
    assert.equal(err.error, "WORKSPACE_INVALID");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
