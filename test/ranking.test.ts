import assert from "node:assert/strict";
import test from "node:test";
import { queryTerms, score } from "../src/ranking.js";
import { snippet } from "../src/snippets.js";
import type { CachedFacts, SourceFile } from "../src/types.js";

function facts(terms: string[]): CachedFacts {
  return { language: "ts", symbols: [], imports: [], terms };
}

function factsWithSymbols(
  terms: string[],
  symbols: Array<{ name: string; startLine: number; endLine: number }>,
): CachedFacts {
  return {
    language: "ts",
    symbols: symbols.map((symbol) => ({
      id: `sym:lib.ts#${symbol.name}:${symbol.startLine}`,
      path: "lib.ts",
      name: symbol.name,
      kind: "function_declaration",
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      exported: true,
    })),
    imports: [],
    terms,
  };
}

function file(path: string, content: string): SourceFile {
  return { path, content, hash: "sha256:00", language: "ts", lines: 1 };
}

test("content term hits score files that path and facts miss", () => {
  const callSite = file("caller.ts", "void uniqueidentifier();\n");
  const unrelated = file("other.ts", "export function noop() {}\n");
  const empty = facts([]);
  const terms = ["uniqueidentifier"];
  assert.ok(score(callSite, empty, terms) > 0);
  assert.ok(score(callSite, empty, terms) > score(unrelated, empty, terms));
});

test("a facts.terms hit outranks an equal content-only hit", () => {
  const bodyOnly = file("caller.ts", "void uniqueidentifier();\n");
  const declared = file("lib.ts", "export function other() {}\n");
  const terms = ["uniqueidentifier"];
  assert.ok(
    score(declared, facts(["uniqueidentifier"]), terms) >
      score(bodyOnly, facts([]), terms),
  );
});

test("changed-path boost is unchanged", () => {
  const sample = file("lib.ts", "export function other() {}\n");
  const empty = facts([]);
  assert.equal(
    score(sample, empty, ["other"], true) - score(sample, empty, ["other"]),
    1_000_000,
  );
});

test("absent ranking hints are bit-identical to the current formula", () => {
  const sample = file("src/lib.ts", "export function other() {}\n");
  const hints = facts(["other"]);
  const terms = ["other"];
  assert.equal(
    score(sample, hints, terms, false, undefined),
    score(sample, hints, terms, false),
  );
  assert.equal(
    score(sample, hints, terms, true, {}),
    score(sample, hints, terms, true),
  );
});

test("boostIdents extend the term set through queryTerms normalization", () => {
  const sample = file("src/lib.ts", "validate token pair\n");
  const empty = facts([]);
  const terms = ["missing"];
  assert.equal(score(sample, empty, terms, false), 0);
  assert.ok(
    score(sample, empty, terms, false, { boostIdents: ["Validate-Token!"] }) > 0,
  );
  assert.deepEqual(queryTerms("Validate-Token!"), ["token", "validate"]);
  assert.deepEqual(queryTerms("validateToken"), ["token", "validate", "validatetoken"]);
  assert.deepEqual(queryTerms("validate_token"), [
    "token",
    "validate",
    "validate_token",
  ]);
});

test("boostPaths multiply relevance by path prefix", () => {
  const boosted = file("src/lib.ts", "export function other() {}\n");
  const hints = facts(["other"]);
  const base = score(boosted, hints, ["other"], false);
  assert.ok(base > 0);
  assert.equal(
    score(boosted, hints, ["other"], false, { boostPaths: ["src"] }),
    base * 10,
  );
  assert.equal(
    score(boosted, hints, ["other"], false, { boostPaths: ["Src"] }),
    base * 10,
  );
  assert.equal(score(boosted, hints, ["other"], false, { boostPaths: ["test"] }), base);
});

test("dampenPaths shrink relevance by path prefix", () => {
  const damped = file("vendor/lib.ts", "export function other() {}\n");
  const hints = facts(["other"]);
  const base = score(damped, hints, ["other"], false);
  assert.ok(base > 0);
  assert.ok(
    Math.abs(
      score(damped, hints, ["other"], false, { dampenPaths: ["vendor"] }) - base * 0.1,
    ) < 1e-9,
  );
});

test("boost and dampen compose multiplicatively on the same file", () => {
  const sample = file("src/lib.ts", "export function other() {}\n");
  const hints = facts(["other"]);
  const base = score(sample, hints, ["other"], false);
  const composed = score(sample, hints, ["other"], false, {
    boostPaths: ["src"],
    dampenPaths: ["src/lib"],
  });
  assert.ok(Math.abs(composed - base * 10 * 0.1) < 1e-9);
});

test("a changed unboosted file outranks a boosted unchanged file", () => {
  const changed = file("a.ts", "export function other() {}\n");
  const boosted = file("b.ts", "export function other() {}\n");
  const hints = facts(["other"]);
  assert.ok(
    score(changed, hints, ["other"], true) >
      score(boosted, hints, ["other"], false, { boostPaths: ["b"] }),
  );
});

test("snippet depth full keeps the current window", () => {
  const sample = file("lib.ts", "line1\nmatch here\nline3");
  const result = snippet(sample, ["match"], "full", facts([]));
  assert.equal(result.startLine, 1);
  assert.equal(result.endLine, 3);
  assert.ok(result.text.includes("match here"));
  assert.equal(result.clipped, false);
});

test("snippet depth signatures is strictly shorter than full on a multi-line file", () => {
  const body = [
    "// header comment",
    "export function validateToken(token) {",
    "  const a = 1;",
    "  const b = 2;",
    "  return token.startsWith('token_');",
    "}",
  ].join("\n");
  const sample = file("lib.ts", body);
  const symbolFacts = factsWithSymbols(
    ["validatetoken"],
    [{ name: "validateToken", startLine: 2, endLine: 6 }],
  );
  const full = snippet(sample, ["token"], "full", symbolFacts);
  const signatures = snippet(sample, ["token"], "signatures", symbolFacts);
  assert.ok(
    Buffer.byteLength(signatures.text, "utf8") < Buffer.byteLength(full.text, "utf8"),
  );
  assert.ok(signatures.text.includes("validateToken"));
  assert.equal(signatures.startLine, 1);
  assert.equal(signatures.endLine, 2);
});

test("snippet depth listing emits an empty, unclipped entry", () => {
  const sample = file("lib.ts", "anything\nmore\n");
  const result = snippet(sample, ["anything"], "listing", facts([]));
  assert.equal(result.text, "");
  assert.equal(result.clipped, false);
  assert.equal(result.startLine, 1);
  assert.equal(result.endLine, 1);
});

test("snippet depth is deterministic for identical inputs", () => {
  const body = "// c\nexport function f() {\n  return 1;\n}\n";
  const sample = file("lib.ts", body);
  const symbolFacts = factsWithSymbols(
    ["f"],
    [{ name: "f", startLine: 2, endLine: 4 }],
  );
  for (const depth of ["full", "signatures", "listing"] as const) {
    assert.deepEqual(
      snippet(sample, ["f"], depth, symbolFacts),
      snippet(sample, ["f"], depth, symbolFacts),
    );
  }
});
