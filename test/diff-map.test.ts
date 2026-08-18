import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { mapDiff } from "../src/analysis/diff-map.js";
import type { FileFact } from "../src/model.js";

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
  const repo = join(tmpdir(), `contextpatrol-diff-test-${Date.now()}`);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(
    join(repo, "src/auth.ts"),
    [
      "export class AuthService {",
      "  rotate() {",
      "    return 1;",
      "  }",
      "}",
      "export function other() {",
      "  return 2;",
      "}",
    ].join("\n"),
  );
  git(["init", "-b", "main"], repo);
  git(["config", "user.email", "test@example.com"], repo);
  git(["config", "user.name", "test"], repo);
  git(["add", "-A"], repo);
  git(["commit", "-m", "initial", "--no-gpg-sign"], repo);
  return { repo, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

const FIXTURES: FileFact[] = [
  {
    path: "src/auth.ts",
    language: "typescript",
    size: 200,
    lines: 10,
    digest: "a1",
    symbols: [
      {
        kind: "class",
        name: "AuthService",
        qualifiedName: "src/auth.ts#AuthService",
        path: "src/auth.ts",
        signature: "class AuthService",
        jsdoc: "",
        source: "",
        range: { startLine: 1, endLine: 5 },
        exported: true,
        confidence: 1.0,
        isTest: false,
        heritage: { extends: [], implements: [] },
      },
      {
        kind: "method",
        name: "rotate",
        qualifiedName: "src/auth.ts#AuthService.rotate",
        path: "src/auth.ts",
        signature: "rotate()",
        jsdoc: "",
        source: "",
        range: { startLine: 2, endLine: 4 },
        exported: false,
        confidence: 1.0,
        isTest: false,
        heritage: { extends: [], implements: [] },
      },
      {
        kind: "function",
        name: "other",
        qualifiedName: "src/auth.ts#other",
        path: "src/auth.ts",
        signature: "function other()",
        jsdoc: "",
        source: "",
        range: { startLine: 6, endLine: 8 },
        exported: true,
        confidence: 1.0,
        isTest: false,
        heritage: { extends: [], implements: [] },
      },
    ],
    imports: [],
    calls: [],
    rationale: [],
    routes: [],
  },
];

test("maps diff hunk line ranges to symbols", () => {
  const { repo, cleanup } = makeRepo();
  try {
    // Write modified version: modify line 3 (inside rotate method)
    const modified = [
      "export class AuthService {",
      "  rotate() {",
      "    console.log('rotate');",
      "    return 1;",
      "  }",
      "}",
      "export function other() {",
      "  return 2;",
      "}",
    ].join("\n");
    writeFileSync(join(repo, "src/auth.ts"), modified);

    // After modification:
    // AuthService range is 1 to 6 (expanded)
    // rotate range is 2 to 5 (expanded)
    // other range is 7 to 9 (shifted)
    // The FileFacts passed will reflect the new ranges when parsed, but for this unit test
    // we pass the original FIXTURES to test matching. The diff hunk for line 3
    // is inside original range of rotate (2 to 4) and AuthService (1 to 5).
    // it does NOT overlap with other (6 to 8).
    const changed = mapDiff(repo, FIXTURES, []);
    assert.ok(changed.has("src/auth.ts#AuthService.rotate"));
    assert.ok(changed.has("src/auth.ts#AuthService"));
    assert.equal(changed.has("src/auth.ts#other"), false);
  } finally {
    cleanup();
  }
});

test("returns empty set on clean tree", () => {
  const { repo, cleanup } = makeRepo();
  try {
    const changed = mapDiff(repo, FIXTURES, []);
    assert.equal(changed.size, 0);
  } finally {
    cleanup();
  }
});

test("falls back to whole file scope for unchanged changedPaths", () => {
  const { repo, cleanup } = makeRepo();
  try {
    // Clean tree, but explicitly request changedPaths
    const changed = mapDiff(repo, FIXTURES, [], ["src/auth.ts"]);
    assert.ok(changed.has("src/auth.ts#AuthService"));
    assert.ok(changed.has("src/auth.ts#AuthService.rotate"));
  } finally {
    cleanup();
  }
});
