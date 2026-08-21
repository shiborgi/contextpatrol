import assert from "node:assert/strict";
import { test } from "node:test";
import { clipText, estimateTokens, packBudget } from "../src/budget.js";
import { canonicalJson, digestOf } from "../src/hash.js";
import { canonicalizePath, isDenied, redact } from "../src/security.js";

test("canonical JSON is stable under key order", () => {
  const a = canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] });
  const b = canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 });
  assert.equal(a, b);
});

test("digestOf ignores object key order", () => {
  assert.equal(digestOf({ a: 1, b: 2 }), digestOf({ b: 2, a: 1 }));
});

test("estimateTokens uses the pinned cl100k estimator", () => {
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("abcdef"), 1);
  assert.ok(estimateTokens("") === 1);
});

test("packBudget respects hard budget for atomic items", () => {
  const result = packBudget(
    [
      { id: "a", estimatedTokens: 100, clipable: false },
      { id: "b", estimatedTokens: 100, clipable: false },
    ],
    150,
  );
  assert.deepEqual(
    result.included.map((i) => i.id),
    ["a"],
  );
  assert.equal(result.totalTokens, 100);
  assert.deepEqual(result.omitted, [{ id: "b", reason: "token-budget" }]);
});

test("packBudget clips clipable items", () => {
  const result = packBudget([{ id: "a", estimatedTokens: 500, clipable: true }], 200);
  assert.equal(result.included[0]?.clipped, true);
  assert.equal(result.included[0]?.estimatedTokens, 200);
});

test("clipText never exceeds budget and marks truncation", () => {
  const long = "x".repeat(1000);
  const clipped = clipText(long, 10);
  assert.ok(estimateTokens(clipped) <= 10);
  assert.ok(clipped.includes("truncated"));
});

test("canonicalizePath rejects traversal and absolutes", () => {
  assert.equal(canonicalizePath("src/a.ts"), "src/a.ts");
  assert.equal(canonicalizePath("./src//a.ts"), "src/a.ts");
  assert.equal(canonicalizePath("../a.ts"), null);
  assert.equal(canonicalizePath("/abs/a.ts"), null);
  assert.equal(canonicalizePath("a\0b"), null);
  assert.equal(canonicalizePath("C:\\a.ts"), null);
});

test("isDenied matches basename and path patterns", () => {
  assert.equal(isDenied(".env", [".env"]), true);
  assert.equal(isDenied("src/.env", [".env"]), true);
  assert.equal(isDenied("node_modules/x.ts", ["node_modules"]), true);
  assert.equal(isDenied("src/node_modules/x.ts", ["**/node_modules/**"]), true);
  assert.equal(isDenied("src/index.ts", [".env"]), false);
});

test("redact removes secrets but keeps prefix", () => {
  const out = redact("const password = 'abc123456789';");
  assert.equal(out.includes("abc123456789"), false);
  assert.ok(out.includes("[REDACTED]"));

  const bearer = redact("Authorization: Bearer abcDEF123456");
  assert.equal(bearer.includes("abcDEF123456"), false);
});
