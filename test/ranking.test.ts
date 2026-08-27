import assert from "node:assert/strict";
import test from "node:test";
import { score } from "../src/ranking.js";
import type { CachedFacts, SourceFile } from "../src/types.js";

function facts(terms: string[]): CachedFacts {
  return { language: "ts", symbols: [], imports: [], terms };
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
