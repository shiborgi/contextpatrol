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
  const byName = new Map(symbols.symbols.map((s) => [s.name, s]));

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
  assert.equal(symbols.symbols[0]?.name, "handler");
  assert.equal(symbols.symbols[0]?.kind, "callable-variable");
});

test("export list marks class, method and constructor exported", () => {
  const symbols = extractSymbols(
    "src/service.ts",
    "class Service { constructor() {} run(): void {} }\nexport { Service };\n",
  );
  const byName = new Map(symbols.symbols.map((s) => [s.name, s]));
  assert.equal(byName.get("Service")?.exported, true);
  assert.equal(byName.get("constructor")?.exported, true);
  assert.equal(byName.get("run")?.exported, true);
});

test("commonjs module.exports object exports the declared symbol", () => {
  const symbols = extractSymbols(
    "src/handle.js",
    "function handle(x) { return x; }\nmodule.exports = { handle };\n",
  );
  const handle = symbols.symbols.find((s) => s.name === "handle");
  assert.equal(handle?.kind, "function");
  assert.equal(handle?.exported, true);
});

test("commonjs exports.x exports the declared symbol", () => {
  const symbols = extractSymbols(
    "src/util.js",
    "function run() { return 1; }\nexports.run = run;\n",
  );
  const run = symbols.symbols.find((s) => s.name === "run");
  assert.equal(run?.kind, "function");
  assert.equal(run?.exported, true);
});

test("typescript export assignment marks the referenced name exported", () => {
  const symbols = extractSymbols(
    "src/main.ts",
    "function main(): void {}\nexport = main;\n",
  );
  const main = symbols.symbols.find((s) => s.name === "main");
  assert.equal(main?.exported, true);
});

test("default export by declaration is exported", () => {
  const symbols = extractSymbols(
    "src/greet.ts",
    "export default function greet(): void {}\n",
  );
  const greet = symbols.symbols.find((s) => s.name === "greet");
  assert.equal(greet?.exported, true);
});

test("default export by assignment marks the referenced name exported", () => {
  const symbols = extractSymbols(
    "src/app.ts",
    "const app = () => 1;\nexport default app;\n",
  );
  const app = symbols.symbols.find((s) => s.name === "app");
  assert.equal(app?.kind, "callable-variable");
  assert.equal(app?.exported, true);
});

test("non-exported class, method and callable variable are not exported", () => {
  const symbols = extractSymbols(
    "src/internal.ts",
    "class Internal { helper(): void {} }\nconst local = () => 1;\n",
  );
  const byName = new Map(symbols.symbols.map((s) => [s.name, s]));
  assert.equal(byName.get("Internal")?.exported, false);
  assert.equal(byName.get("helper")?.exported, false);
  assert.equal(byName.get("local")?.exported, false);
});

// --- WORK-1.2.1: ImportFact extraction ---

test("extracts named, default, namespace and side-effect imports", () => {
  const src = [
    'import "./polyfill.js";',
    'import def from "./mod.js";',
    'import * as ns from "./ns.js";',
    'import { a, b as c } from "./named.js";',
  ].join("\n");
  const { imports } = extractSymbols("src/entry.ts", src);
  const kinds = imports.map((i) => i.kind);
  assert.deepEqual(kinds, ["side-effect", "default", "namespace", "named", "named"]);
  assert.equal(imports[0]?.moduleSpecifier, "./polyfill.js");
  assert.equal(imports[1]?.importedName, "def");
  assert.equal(imports[2]?.importedName, "ns");
  assert.equal(imports[3]?.importedName, "a");
  assert.equal(imports[4]?.importedName, "c");
});

test("import extraction is deterministic", () => {
  const src = 'import { x } from "./a.js";\nimport y from "./b.js";\n';
  const a = extractSymbols("src/m.ts", src);
  const b = extractSymbols("src/m.ts", src);
  assert.deepEqual(a.imports, b.imports);
});

// --- WORK-1.2.2: CallFact extraction ---

test("captures identifier, property and this receiver calls with caller attribution", () => {
  const src = [
    "function outer(): void {",
    "  helper();",
    "  obj.run();",
    "}",
    "class S {",
    "  m(): void { this.exec(); }",
    "}",
  ].join("\n");
  const { calls } = extractSymbols("src/c.ts", src);
  const byCallee = new Map(calls.map((c) => [c.calleeText, c]));
  assert.equal(byCallee.get("helper")?.receiver, "identifier");
  assert.equal(byCallee.get("helper")?.callerQualifiedName, "src/c.ts#outer");
  assert.equal(byCallee.get("obj.run")?.receiver, "property");
  assert.equal(byCallee.get("this.exec")?.receiver, "this");
  assert.equal(byCallee.get("this.exec")?.callerQualifiedName, "src/c.ts#S.m");
});

test("nested calls and method chains are deterministic", () => {
  const src = "function f(): void { foo(bar()); chain.a().b(); }\n";
  const a = extractSymbols("src/n.ts", src);
  const b = extractSymbols("src/n.ts", src);
  assert.deepEqual(a.calls, b.calls);
  const texts = a.calls.map((c) => c.calleeText);
  assert.ok(texts.includes("foo"));
  assert.ok(texts.includes("bar"));
  assert.ok(texts.includes("chain.a"));
  assert.ok(texts.includes("chain.a().b"));
});

// --- WORK-1.2.3: RationaleFact + isTest ---

test("rationale markers attach to the following symbol with marker kind", () => {
  const src = [
    "// HACK: temporary workaround for legacy parser",
    "export function parse(): void {}",
    "// TODO: add retry",
    "export function fetchAll(): void {}",
  ].join("\n");
  const { rationale } = extractSymbols("src/r.ts", src);
  assert.equal(rationale.length, 2);
  assert.equal(rationale[0]?.marker, "HACK");
  assert.equal(rationale[0]?.symbolQualifiedName, "src/r.ts#parse");
  assert.ok(rationale[0]?.text.includes("temporary workaround"));
  assert.equal(rationale[1]?.marker, "TODO");
  assert.equal(rationale[1]?.symbolQualifiedName, "src/r.ts#fetchAll");
});

test("isTest is true for test path patterns and false otherwise", () => {
  const src = "export function x(): void {}\n";
  assert.equal(extractSymbols("src/a.test.ts", src).symbols[0]?.isTest, true);
  assert.equal(extractSymbols("src/a.spec.ts", src).symbols[0]?.isTest, true);
  assert.equal(extractSymbols("test/a.ts", src).symbols[0]?.isTest, true);
  assert.equal(extractSymbols("src/__tests__/a.ts", src).symbols[0]?.isTest, true);
  assert.equal(extractSymbols("src/a.ts", src).symbols[0]?.isTest, false);
});
