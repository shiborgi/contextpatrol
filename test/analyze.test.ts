import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { queryContext } from "../src/analyze.js";

test("query uses indexed facts and honors exact output bytes", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    writeFileSync(
      path.join(workspace, "service.ts"),
      "export function authenticate(token: string) { return token.length > 0; }\n",
    );
    writeFileSync(
      path.join(workspace, "service.test.ts"),
      "import { authenticate } from './service';\nvoid authenticate('token');\n",
    );
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const request = {
      schemaVersion: 1 as const,
      workspace,
      query: "authenticate token",
      facets: ["structure", "symbols", "relations", "source", "tests"] as const,
      maxOutputBytes: 8_192,
      target: { kind: "working-tree" as const },
    };
    const first = await queryContext({
      ...request,
      facets: [...request.facets],
    });
    const second = await queryContext({
      ...request,
      facets: [...request.facets],
    });
    assert.equal(first.reportDigest, second.reportDigest);
    assert.ok(first.budget.outputBytes <= request.maxOutputBytes);
    assert.ok(first.symbols.some((symbol) => symbol.name === "authenticate"));
    assert.deepEqual(first.relations, [
      { kind: "imports", from: "service.test.ts", to: "service.ts" },
    ]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("body-only call sites rank above unrelated files", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    writeFileSync(path.join(workspace, "unrelated.ts"), "export function noop() {}\n");
    writeFileSync(path.join(workspace, "caller.ts"), "void uniqueidentifier();\n");
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const report = await queryContext({
      schemaVersion: 1,
      workspace,
      query: "uniqueidentifier",
      facets: ["structure"],
      maxOutputBytes: 8_192,
      target: { kind: "working-tree" },
    });
    const caller = report.files.find((entry) => entry.path === "caller.ts");
    const unrelated = report.files.find((entry) => entry.path === "unrelated.ts");
    assert.ok(caller);
    assert.ok(unrelated);
    assert.ok(caller.score > unrelated.score);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("limited baseline query keeps a changed path", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    const pad = "export const value = 'x'.repeat(80);\n".repeat(40);
    for (const name of ["alpha.ts", "beta.ts", "gamma.ts", "delta.ts"]) {
      writeFileSync(
        path.join(workspace, name),
        `export function ${name.slice(0, -3)}() {}\n${pad}`,
      );
    }
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "base"]);
    const baseline = execFileSync("git", ["-C", workspace, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    writeFileSync(
      path.join(workspace, "changed.ts"),
      "export function changed() { return 1; }\n",
    );
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "change"]);
    const head = execFileSync("git", ["-C", workspace, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const report = await queryContext({
      schemaVersion: 1,
      workspace,
      query: "alpha beta gamma",
      facets: ["structure", "symbols", "relations", "source", "changes", "tests"],
      maxOutputBytes: 2_048,
      target: { kind: "commit", oid: head },
      baseline: { oid: baseline },
    });
    assert.equal(report.budget.limited, true);
    assert.ok(report.changes.some((entry) => entry.path === "changed.ts"));
    assert.equal(
      report.changes.length === 0 &&
        report.files.length === 0 &&
        report.relations.length === 0,
      false,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("sourceDepth variants bound snippet detail end to end", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    execFileSync("mkdir", ["-p", path.join(workspace, "src")]);
    writeFileSync(
      path.join(workspace, "src", "token.js"),
      [
        "// validate the token prefix",
        "export function validateToken(token) {",
        "  if (!token.startsWith('token_')) {",
        "    return false;",
        "  }",
        "  return true;",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(workspace, "src", "consumer.ts"),
      "import { validateToken } from './token.js';\nexport function authorize(token: string): boolean {\n  return validateToken(token);\n}\n",
    );
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const base = {
      schemaVersion: 1 as const,
      workspace,
      query: "token validate",
      facets: ["structure", "symbols", "source"] as const,
      maxOutputBytes: 16_384,
      target: { kind: "working-tree" as const },
    };
    const full = await queryContext({ ...base, facets: [...base.facets] });
    const signatures = await queryContext({
      ...base,
      facets: [...base.facets],
      sourceDepth: "signatures",
    });
    const listing = await queryContext({
      ...base,
      facets: [...base.facets],
      sourceDepth: "listing",
    });
    const fullToken = full.snippets.find((entry) => entry.path === "src/token.js");
    const signaturesToken = signatures.snippets.find(
      (entry) => entry.path === "src/token.js",
    );
    assert.ok(fullToken);
    assert.ok(signaturesToken);
    assert.ok(
      Buffer.byteLength(signaturesToken.text, "utf8") <
        Buffer.byteLength(fullToken.text, "utf8"),
    );
    assert.ok(listing.snippets.length > 0);
    for (const entry of listing.snippets) {
      assert.equal(entry.text, "");
      assert.equal(entry.clipped, false);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("ranking and sourceDepth compose deterministically end to end", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    execFileSync("mkdir", ["-p", path.join(workspace, "src")]);
    writeFileSync(
      path.join(workspace, "src", "token.js"),
      [
        "// validate the token prefix",
        "export function validateToken(token) {",
        "  return token.startsWith('token_');",
        "}",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(workspace, "src", "caller.ts"),
      "import { validateToken } from './token.js';\nvoid validateToken('token_x');\n",
    );
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const request = {
      schemaVersion: 1 as const,
      workspace,
      query: "token",
      facets: ["structure", "symbols", "source"] as const,
      maxOutputBytes: 16_384,
      target: { kind: "working-tree" as const },
      sourceDepth: "signatures" as const,
      ranking: { boostIdents: ["validateToken"], boostPaths: ["src"] },
    };
    const first = await queryContext({ ...request, facets: [...request.facets] });
    const second = await queryContext({ ...request, facets: [...request.facets] });
    assert.equal(first.reportDigest, second.reportDigest);
    assert.equal(first.summary.rankingHintsApplied, true);
    const plain = await queryContext({
      schemaVersion: 1,
      workspace,
      query: "token",
      facets: ["structure", "symbols", "source"],
      maxOutputBytes: 16_384,
      target: { kind: "working-tree" },
    });
    assert.equal(plain.summary.rankingHintsApplied, undefined);
    for (let index = 0; index < 6; index += 1) {
      const prior = index === 0 ? null : `m${index - 1}`;
      writeFileSync(
        path.join(workspace, "src", `m${index}.ts`),
        `${prior ? `import { f${index - 1} } from './m${index - 1}.js';\n` : ""}` +
          `export function f${index}() {\n  return ${index};\n}\n`,
      );
    }
    const ladderFacets = ["structure", "symbols", "relations", "source"] as const;
    const wide = await queryContext({
      schemaVersion: 1,
      workspace,
      query: "token",
      facets: [...ladderFacets],
      maxOutputBytes: 16_384,
      target: { kind: "working-tree" },
    });
    const narrow = await queryContext({
      schemaVersion: 1,
      workspace,
      query: "token",
      facets: [...ladderFacets],
      maxOutputBytes: 1_200,
      target: { kind: "working-tree" },
    });
    assert.equal(wide.budget.limited, false);
    assert.equal(narrow.budget.limited, true);
    assert.ok(
      wide.relations.length > narrow.relations.length,
      "the narrow budget must trim at least one relation",
    );
    if (narrow.relations.length < wide.relations.length)
      assert.equal(
        narrow.snippets.length,
        0,
        "trim ladder must exhaust snippets before relations",
      );
    if (narrow.symbols.length < wide.symbols.length)
      assert.equal(
        narrow.relations.length,
        0,
        "trim ladder must exhaust relations before symbols",
      );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("section digests are stable across repeated full and limited runs", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    writeFileSync(path.join(workspace, "a.ts"), "export function a() {}\n");
    writeFileSync(path.join(workspace, "b.ts"), "export function b() {}\n");
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const base = {
      schemaVersion: 1 as const,
      workspace,
      query: "a b",
      facets: ["structure", "symbols", "relations", "source"] as const,
      maxOutputBytes: 8_192,
      target: { kind: "working-tree" as const },
      includeSectionDigests: true as const,
    };
    const full1 = await queryContext({ ...base, facets: [...base.facets] });
    const full2 = await queryContext({ ...base, facets: [...base.facets] });
    assert.deepEqual(full1.sectionDigests, full2.sectionDigests);
    assert.equal(full1.reportDigest, full2.reportDigest);
    assert.ok(full1.sectionDigests);
    for (const key of [
      "changes",
      "coverage",
      "files",
      "relations",
      "snippets",
      "symbols",
      "tests",
    ]) {
      assert.match(
        full1.sectionDigests[key as keyof typeof full1.sectionDigests],
        /^sha256:[a-f0-9]{64}$/,
      );
    }
    const narrow = await queryContext({
      ...base,
      facets: [...base.facets],
      maxOutputBytes: 1_600,
    });
    assert.equal(narrow.budget.limited, true);
    const narrow2 = await queryContext({
      ...base,
      facets: [...base.facets],
      maxOutputBytes: 1_600,
    });
    assert.equal(narrow.reportDigest, narrow2.reportDigest);
    assert.deepEqual(narrow.sectionDigests, narrow2.sectionDigests);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("opted-in and legacy outputs differ only by the section digest block", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    writeFileSync(path.join(workspace, "a.ts"), "export function a() {}\n");
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const plain = await queryContext({
      schemaVersion: 1,
      workspace,
      query: "a",
      facets: ["structure", "symbols"],
      maxOutputBytes: 4_096,
      target: { kind: "working-tree" },
    });
    const opted = await queryContext({
      schemaVersion: 1,
      workspace,
      query: "a",
      facets: ["structure", "symbols"],
      maxOutputBytes: 4_096,
      target: { kind: "working-tree" },
      includeSectionDigests: true,
    });
    assert.ok(opted.sectionDigests);
    const {
      sectionDigests,
      reportDigest: optedDigest,
      requestDigest: optedRequestDigest,
      budget: optedBudget,
      ...optedRest
    } = opted;
    const {
      reportDigest: plainDigest,
      requestDigest: plainRequestDigest,
      budget: plainBudget,
      ...plainRest
    } = plain;
    assert.deepEqual(optedRest, plainRest);
    assert.deepEqual(
      { ...optedBudget, outputBytes: 0 },
      { ...plainBudget, outputBytes: 0 },
    );
    assert.notEqual(optedRequestDigest, plainRequestDigest);
    assert.ok(optedBudget.outputBytes > plainBudget.outputBytes);
    assert.notEqual(optedDigest, plainDigest);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("repeated dirty runs change only the changed section digest", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-"));
  try {
    execFileSync("git", ["init", "-q", workspace]);
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", workspace, "config", "user.name", "Test"]);
    writeFileSync(path.join(workspace, "a.ts"), "export function a() {}\n");
    execFileSync("git", ["-C", workspace, "add", "."]);
    execFileSync("git", ["-C", workspace, "commit", "-qm", "fixture"]);
    const request = {
      schemaVersion: 1 as const,
      workspace,
      query: "a",
      facets: ["structure", "symbols", "source"] as const,
      maxOutputBytes: 4_096,
      target: { kind: "working-tree" as const },
      includeSectionDigests: true as const,
    };
    const first = await queryContext({ ...request, facets: [...request.facets] });
    writeFileSync(path.join(workspace, "a.ts"), "export function a() { return 1; }\n");
    const second = await queryContext({ ...request, facets: [...request.facets] });
    assert.ok(first.sectionDigests);
    assert.ok(second.sectionDigests);
    const changed = new Set<string>();
    const keys = Object.keys(first.sectionDigests) as Array<
      keyof NonNullable<typeof first.sectionDigests>
    >;
    for (const key of keys) {
      if (first.sectionDigests[key] !== second.sectionDigests[key]) changed.add(key);
    }
    assert.ok(changed.size > 0, "at least one section digest must change");
    for (const stable of ["changes", "coverage", "relations", "tests"]) {
      assert.ok(!changed.has(stable), `${stable} digest must remain unchanged`);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
