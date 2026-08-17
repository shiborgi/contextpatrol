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

test("export list marks class, method and constructor exported", () => {
  const symbols = extractSymbols(
    "src/service.ts",
    "class Service { constructor() {} run(): void {} }\nexport { Service };\n",
  );
  const byName = new Map(symbols.map((s) => [s.name, s]));
  assert.equal(byName.get("Service")?.exported, true);
  assert.equal(byName.get("constructor")?.exported, true);
  assert.equal(byName.get("run")?.exported, true);
});

test("commonjs module.exports object exports the declared symbol", () => {
  const symbols = extractSymbols(
    "src/handle.js",
    "function handle(x) { return x; }\nmodule.exports = { handle };\n",
  );
  const handle = symbols.find((s) => s.name === "handle");
  assert.equal(handle?.kind, "function");
  assert.equal(handle?.exported, true);
});

test("commonjs exports.x exports the declared symbol", () => {
  const symbols = extractSymbols(
    "src/util.js",
    "function run() { return 1; }\nexports.run = run;\n",
  );
  const run = symbols.find((s) => s.name === "run");
  assert.equal(run?.kind, "function");
  assert.equal(run?.exported, true);
});

test("typescript export assignment marks the referenced name exported", () => {
  const symbols = extractSymbols(
    "src/main.ts",
    "function main(): void {}\nexport = main;\n",
  );
  const main = symbols.find((s) => s.name === "main");
  assert.equal(main?.exported, true);
});

test("default export by declaration is exported", () => {
  const symbols = extractSymbols(
    "src/greet.ts",
    "export default function greet(): void {}\n",
  );
  const greet = symbols.find((s) => s.name === "greet");
  assert.equal(greet?.exported, true);
});

test("default export by assignment marks the referenced name exported", () => {
  const symbols = extractSymbols(
    "src/app.ts",
    "const app = () => 1;\nexport default app;\n",
  );
  const app = symbols.find((s) => s.name === "app");
  assert.equal(app?.kind, "callable-variable");
  assert.equal(app?.exported, true);
});

test("non-exported class, method and callable variable are not exported", () => {
  const symbols = extractSymbols(
    "src/internal.ts",
    "class Internal { helper(): void {} }\nconst local = () => 1;\n",
  );
  const byName = new Map(symbols.map((s) => [s.name, s]));
  assert.equal(byName.get("Internal")?.exported, false);
  assert.equal(byName.get("helper")?.exported, false);
  assert.equal(byName.get("local")?.exported, false);
});
