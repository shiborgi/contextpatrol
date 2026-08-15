import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PackRequest } from "../src/contracts.js";
import { pack } from "../src/pack.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    encoding: "utf8",
  });
}

function makeRepo(): { repo: string; cleanup: () => void } {
  const repo = mkdtempSync(join(tmpdir(), "contextpatrol-test-"));
  mkdirSync(join(repo, "src"));
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2),
  );
  writeFileSync(
    join(repo, "src", "auth.ts"),
    [
      "export class AuthService {",
      "  rotate(secret: string): string {",
      "    return secret + '-rotated';",
      "  }",
      "}",
      "",
      "export function tokenize(input: string): string[] {",
      "  return input.split(' ');",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(join(repo, ".env"), "SECRET=super-secret-value\n");
  git(["init", "-b", "main"], repo);
  git(["config", "user.email", "test@example.com"], repo);
  git(["config", "user.name", "test"], repo);
  git(["add", "-A"], repo);
  git(["commit", "-m", "fixture", "--no-gpg-sign"], repo);
  return { repo, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

test("pack recovers symbols, respects budget, redacts secrets", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "auth token rotation",
      focus: ["architecture", "symbols", "source"],
      tokenBudget: 2000,
    });

    assert.equal(capsule.protocolVersion, 1);
    assert.equal(capsule.schemaVersion, 1);
    assert.ok(capsule.capsuleId.startsWith("ctx-"));

    const titles = capsule.evidence.map((e) => e.title);
    assert.ok(titles.includes("AuthService"));
    assert.ok(titles.includes("tokenize"));

    assert.ok(capsule.budget.estimatedTokens <= capsule.budget.requestedTokens);

    const text = JSON.stringify(capsule);
    assert.equal(text.includes("super-secret-value"), false);
    assert.equal(text.includes(".env"), false);
  } finally {
    cleanup();
  }
});

test("pack is deterministic for identical input", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const request: PackRequest = {
      protocolVersion: 1,
      workspace: repo,
      intent: "auth",
      focus: ["symbols"],
      tokenBudget: 800,
    };
    const a = await pack(request);
    const b = await pack(request);
    assert.equal(a.capsuleDigest, b.capsuleDigest);
  } finally {
    cleanup();
  }
});

test("pack applies the default denylist to AST files", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    mkdirSync(join(repo, "secrets"));
    writeFileSync(
      join(repo, "secrets", "leak.ts"),
      "export function credential() { return 'ghp_undetected'; }\n",
    );
    git(["add", "-A"], repo);
    git(["commit", "-m", "add secret", "--no-gpg-sign"], repo);

    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "credential",
      focus: ["symbols", "source"],
      tokenBudget: 2000,
    });

    const titles = capsule.evidence.map((e) => e.title);
    assert.equal(titles.includes("credential"), false);
    assert.ok(capsule.warnings.some((w) => w.includes("denylist")));
  } finally {
    cleanup();
  }
});
