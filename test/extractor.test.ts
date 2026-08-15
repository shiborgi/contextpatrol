import assert from "node:assert/strict";
import { test } from "node:test";

import { extractSymbols } from "../src/typescript-extractor.js";

const SAMPLE = `
/** Rotates a token. */
export class AuthService {
  constructor(private secret: string) {}

  rotate(input: string): string {
    return input + this.secret;
  }
}

export function tokenize(value: string): string[] {
  return value.split(' ');
}

interface Token { raw: string; }

type Alias = string;

enum State { Idle, Busy }
`;

test("extracts class, method, function, interface, type, enum", () => {
  const symbols = extractSymbols("src/auth.ts", SAMPLE);
  const byName = new Map(symbols.map((s) => [s.name, s]));

  assert.ok(byName.has("AuthService"));
  assert.ok(byName.has("rotate"));
  assert.ok(byName.has("constructor"));
  assert.ok(byName.has("tokenize"));
  assert.ok(byName.has("Token"));
  assert.ok(byName.has("Alias"));
  assert.ok(byName.has("State"));

  const auth = byName.get("AuthService");
  assert.equal(auth?.exported, true);
  assert.equal(auth?.qualifiedName, "src/auth.ts#AuthService");
  assert.ok(auth?.jsdoc.includes("Rotates a token"));

  const rotate = byName.get("rotate");
  assert.equal(rotate?.qualifiedName, "src/auth.ts#AuthService.rotate");
  assert.ok(rotate?.range.startLine > 1);
  assert.ok(rotate?.range.endLine >= rotate.range.startLine);
});

test("produces deterministic output", () => {
  const a = extractSymbols("src/auth.ts", SAMPLE);
  const b = extractSymbols("src/auth.ts", SAMPLE);
  assert.deepEqual(a, b);
});

test("captures callable variables", () => {
  const symbols = extractSymbols("src/x.ts", "const handler = (x: number) => x * 2;");
  assert.equal(symbols[0]?.name, "handler");
  assert.equal(symbols[0]?.kind, "callable-variable");
});
