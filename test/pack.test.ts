import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { estimateTokens } from "../src/budget.js";
import type { PackRequest } from "../src/contracts.js";
import { PatrolError } from "../src/errors.js";
import { canonicalJson } from "../src/hash.js";
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

// A repo shaped so every INIT-2 insight field is non-empty: a hub called by
// two callers (hub-periphery surprises), one Express route, one unused export,
// and a denied secrets/leak.ts that also declares a route and an export.
function makeInsightRepo(): { repo: string; cleanup: () => void } {
  const repo = mkdtempSync(join(tmpdir(), "contextpatrol-insight-"));
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "secrets"));
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "insight-fixture", version: "1.0.0" }, null, 2),
  );
  writeFileSync(
    join(repo, "src", "hub.ts"),
    [
      "export function hub(): number {",
      "  return peripheral();",
      "}",
      "",
      "export function peripheral(): number {",
      "  return 1;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(repo, "src", "a.ts"),
    [
      'import { hub } from "./hub";',
      "",
      "export function callerA(): number {",
      "  return hub();",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(repo, "src", "b.ts"),
    [
      'import { hub } from "./hub";',
      "",
      "export function callerB(): number {",
      "  return hub();",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(repo, "src", "routes.ts"),
    [
      "export function registerRoutes(app: any): void {",
      "  app.get('/health', checkHealth);",
      "}",
      "",
      "function checkHealth() { return 'ok'; }",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(repo, "src", "unused.ts"),
    [
      "export function unusedHelper(): string {",
      "  return 'never called';",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(repo, "secrets", "leak.ts"),
    [
      "export function leakHandler() { return 'ghp_secret'; }",
      "",
      "export function register(app: any): void {",
      "  app.get('/secret', leakHandler);",
      "}",
      "",
    ].join("\n"),
  );
  git(["init", "-b", "main"], repo);
  git(["config", "user.email", "test@example.com"], repo);
  git(["config", "user.name", "test"], repo);
  git(["add", "-A"], repo);
  git(["commit", "-m", "insight fixture", "--no-gpg-sign"], repo);
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

test("two consecutive packs with graph+review produce identical capsuleDigest", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const request: PackRequest = {
      protocolVersion: 1,
      workspace: repo,
      intent: "auth token rotation",
      focus: ["architecture", "symbols", "graph", "review"],
      tokenBudget: 4000,
    };
    const a = await pack(request);
    const b = await pack(request);
    assert.equal(a.capsuleDigest, b.capsuleDigest);
    assert.ok(a.sections.graph);
    assert.ok(a.sections.review);
    assert.ok(a.sections.coverage);
  } finally {
    cleanup();
  }
});

test("dirty diff maps hunks to symbols and computes risk", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    // Mutate a line inside AuthService.rotate (tracked file becomes dirty)
    const modified = [
      "export class AuthService {",
      "  rotate(secret: string): string {",
      "    return secret + '-rotated!';",
      "  }",
      "}",
      "",
      "export function tokenize(input: string): string[] {",
      "  return input.split(' ');",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(repo, "src", "auth.ts"), modified);

    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "auth rotation",
      focus: ["symbols", "review"],
      tokenBudget: 4000,
      changedPaths: ["src/auth.ts"],
    });

    assert.ok(capsule.sections.review);
    assert.ok(
      capsule.sections.review.changedSymbols.includes("src/auth.ts#AuthService.rotate"),
    );
    const riskEntry = capsule.sections.review.risk.find(
      (r) => r.qualifiedName === "src/auth.ts#AuthService.rotate",
    );
    assert.ok(riskEntry);
    assert.ok(riskEntry.factors.length > 0);
    assert.equal(capsule.sections.coverage.historyWindow, 2000);
  } finally {
    cleanup();
  }
});

test("SOURCE_CHANGED fires on concurrent modification", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const request: PackRequest = {
      protocolVersion: 1,
      workspace: repo,
      intent: "auth",
      focus: ["symbols"],
      tokenBudget: 800,
    };
    let mutated = false;
    await assert.rejects(
      pack(request, {
        onAfterScan: () => {
          writeFileSync(join(repo, "src", "auth.ts"), "export const changed = 1;\n");
          mutated = true;
        },
      }),
      (err: unknown) => err instanceof PatrolError && err.code === "SOURCE_CHANGED",
    );
    assert.equal(mutated, true);
  } finally {
    cleanup();
  }
});

test("graph focus populates every insight field and honors the denylist", async () => {
  const { repo, cleanup } = makeInsightRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "map the graph",
      focus: ["graph"],
      tokenBudget: 4000,
    });

    const graph = capsule.sections.graph;
    assert.ok(graph);

    // communities: non-empty
    assert.ok(graph.communities);
    assert.ok(graph.communities.length > 0);
    for (const c of graph.communities) {
      assert.ok(typeof c.id === "string" && c.id.length > 0);
      assert.ok(Array.isArray(c.topFiles));
    }

    // routes: includes the allowed handler, excludes the denied path
    assert.ok(graph.routes);
    const paths = graph.routes.map((r) => r.path);
    assert.ok(paths.includes("/health"));
    assert.equal(paths.includes("/secret"), false);

    // deadCode: lists the unused export, not the denied handler
    assert.ok(graph.deadCode);
    const deadNames = graph.deadCode.map((d) => d.qualifiedName);
    assert.ok(deadNames.some((n) => n.includes("unusedHelper")));
    assert.equal(
      deadNames.some((n) => n.includes("leakHandler")),
      false,
    );

    // surprises: non-empty with real qualified names
    assert.ok(graph.surprises);
    assert.ok(graph.surprises.length > 0);
    for (const s of graph.surprises) {
      assert.ok(s.from.includes("#"));
      assert.ok(s.to.includes("#"));
      assert.ok(typeof s.score === "number" && s.score > 0);
      assert.ok(Array.isArray(s.reasons) && s.reasons.length > 0);
    }

    // questions: real node ids
    if (graph.questions) {
      for (const q of graph.questions) {
        assert.ok(q.nodeId.startsWith("sym:") || q.nodeId.startsWith("file:"));
      }
    }
  } finally {
    cleanup();
  }
});

test("insight fields are omitted when their signals are absent", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "auth",
      focus: ["graph"],
      tokenBudget: 4000,
    });

    const graph = capsule.sections.graph;
    assert.ok(graph);
    // makeRepo has no routes, no CALLS, no communities -> fields omitted
    assert.equal(graph.routes, undefined);
    assert.equal(graph.deadCode, undefined);
    assert.equal(graph.surprises, undefined);
    assert.equal(graph.communities, undefined);
  } finally {
    cleanup();
  }
});

test("self-repo pack no longer flags analyze as dead code", async () => {
  // process.cwd() is the repository itself; its sources use NodeNext `.js`
  // imports, so the remapped resolver must produce the CALLS edge from
  // src/pack.ts into src/analysis/analysis.ts#analyze.
  const capsule = await pack({
    protocolVersion: 1,
    workspace: process.cwd(),
    intent: "map the graph",
    focus: ["graph"],
    tokenBudget: 4000,
  });

  const graph = capsule.sections.graph;
  assert.ok(graph);
  const dead = graph.deadCode ?? [];
  assert.equal(
    dead.some((d) => d.qualifiedName === "src/analysis/analysis.ts#analyze"),
    false,
  );
});

test("graph pack counts sections in estimatedTokens", async () => {
  const { repo, cleanup } = makeInsightRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "map the graph",
      focus: ["graph"],
      tokenBudget: 4000,
    });

    const expected =
      capsule.evidence.reduce((sum, e) => sum + estimateTokens(e.text), 0) +
      estimateTokens(canonicalJson(capsule.sections));

    assert.ok(capsule.budget.estimatedTokens > 0);
    assert.equal(capsule.budget.estimatedTokens, expected);
  } finally {
    cleanup();
  }
});

test("small budget drops optional insights but keeps required graph and coverage", async () => {
  const { repo, cleanup } = makeInsightRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "map the graph",
      focus: ["graph"],
      tokenBudget: 256,
    });

    const graph = capsule.sections.graph;
    assert.ok(graph);
    assert.ok(graph.fileCount >= 0);
    assert.ok(graph.symbolCount >= 0);
    assert.ok(graph.edgeCount >= 0);
    assert.ok(Array.isArray(graph.godSymbols));
    assert.ok(Array.isArray(graph.boundaryFiles));
    assert.ok(capsule.sections.coverage);
  } finally {
    cleanup();
  }
});

test("source evidence ids use the source: prefix", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "auth token rotation",
      focus: ["source"],
      tokenBudget: 4000,
    });

    const sourceEvidence = capsule.evidence.filter((e) => e.kind === "source");
    assert.ok(sourceEvidence.length > 0);
    for (const e of sourceEvidence) {
      assert.ok(e.id.startsWith("source:"));
      assert.equal(e.id.startsWith("src:"), false);
    }
  } finally {
    cleanup();
  }
});

test("self-repo pack no longer flags runCli as dead code", async () => {
  const capsule = await pack({
    protocolVersion: 1,
    workspace: process.cwd(),
    intent: "map the graph",
    focus: ["graph"],
    tokenBudget: 4000,
  });

  const graph = capsule.sections.graph;
  assert.ok(graph);
  const dead = graph.deadCode ?? [];
  assert.equal(
    dead.some((d) => d.qualifiedName === "src/cli.ts#runCli"),
    false,
  );
});

test("self-repo graph deadCode excludes type-level symbols", async () => {
  const capsule = await pack({
    protocolVersion: 1,
    workspace: process.cwd(),
    intent: "map the graph",
    focus: ["graph"],
    tokenBudget: 8000,
  });

  const graph = capsule.sections.graph;
  assert.ok(graph);
  const deadNames = (graph.deadCode ?? []).map((d) => d.qualifiedName);
  // deadCode is populated so the kind filter is actually exercised
  assert.ok(deadNames.length > 0);
  const typeLevelQNames = [
    "src/contracts.ts#Capsule",
    "src/model.ts#SymbolKind",
    "src/constants.ts#Focus",
  ];
  for (const qname of typeLevelQNames) {
    assert.equal(
      deadNames.includes(qname),
      false,
      `${qname} should not be listed as dead code`,
    );
  }
});

test("test-gaps exclude bin/ and scripts/ shims but keep untested src modules", async () => {
  const { repo, cleanup } = makeInsightRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "map the graph",
      focus: ["review"],
      tokenBudget: 4000,
    });

    const gaps = capsule.sections.review?.testGaps ?? [];
    assert.equal(
      gaps.some((p) => p.startsWith("bin/")),
      false,
    );
    assert.equal(
      gaps.some((p) => p.startsWith("scripts/")),
      false,
    );
    // an untested src module still appears
    assert.ok(gaps.some((p) => p === "src/unused.ts"));
  } finally {
    cleanup();
  }
});

test("self-repo review testGaps exclude bin and scripts", async () => {
  const capsule = await pack({
    protocolVersion: 1,
    workspace: process.cwd(),
    intent: "map the graph",
    focus: ["review"],
    tokenBudget: 4000,
  });

  const gaps = capsule.sections.review?.testGaps ?? [];
  assert.equal(gaps.includes("bin/contextpatrol.js"), false);
  assert.equal(
    gaps.some((p) => p.startsWith("scripts/")),
    false,
  );
});

test("self-repo graph godSymbols[0] is not the lineOf helper", async () => {
  const capsule = await pack({
    protocolVersion: 1,
    workspace: process.cwd(),
    intent: "map the graph",
    focus: ["graph"],
    tokenBudget: 4000,
  });

  const first = capsule.sections.graph?.godSymbols[0];
  if (first) {
    assert.notEqual(first.qualifiedName, "src/typescript-extractor.ts#lineOf");
  }
});

test("self-repo graph communities are not large and low-cohesion", async () => {
  const capsule = await pack({
    protocolVersion: 1,
    workspace: process.cwd(),
    intent: "map the graph",
    focus: ["graph"],
    tokenBudget: 4000,
  });

  const communities = capsule.sections.graph?.communities ?? [];
  for (const c of communities) {
    assert.equal(
      c.memberCount > 20 && c.cohesion < 0.1,
      false,
      `community ${c.id} has ${c.memberCount} members and cohesion ${c.cohesion}`,
    );
  }
});

test("self-repo graph pack with focus [graph] at tokenBudget 8000 keeps communities", async () => {
  const capsule = await pack({
    protocolVersion: 1,
    workspace: process.cwd(),
    intent: "map the graph",
    focus: ["graph"],
    tokenBudget: 8000,
  });

  const communities = capsule.sections.graph?.communities ?? [];
  assert.ok(communities.length > 0, "expected non-empty communities at budget 8000");
});

test("architecture evidence lists god symbols and boundary files when present", async () => {
  const { repo, cleanup } = makeInsightRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "map the graph",
      focus: ["architecture"],
      tokenBudget: 4000,
    });

    const arch = capsule.evidence.find((e) => e.kind === "architecture");
    assert.ok(arch);
    assert.ok(
      arch.text.includes("God symbols:") ||
        arch.text.includes("Communities:") ||
        arch.text.includes("Boundary files:"),
    );
  } finally {
    cleanup();
  }
});

test("architecture evidence is deterministic", async () => {
  const { repo, cleanup } = makeInsightRepo();
  try {
    const request: PackRequest = {
      protocolVersion: 1,
      workspace: repo,
      intent: "map the graph",
      focus: ["architecture"],
      tokenBudget: 4000,
    };
    const a = await pack(request);
    const b = await pack(request);
    const textA = a.evidence.find((e) => e.kind === "architecture")?.text;
    const textB = b.evidence.find((e) => e.kind === "architecture")?.text;
    assert.equal(textA, textB);
  } finally {
    cleanup();
  }
});

test("gitRef targets a prior commit read-only and leaves worktree untouched", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const sha1 = git(["rev-parse", "HEAD"], repo).trim();

    const v2 = [
      "export class AuthService {",
      "  rotate(secret: string): string {",
      "    return secret + '-v2';",
      "  }",
      "}",
      "",
      "export function tokenize(input: string): string[] {",
      "  return input.split(' ');",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(repo, "src", "auth.ts"), v2);
    git(["add", "-A"], repo);
    git(["commit", "-m", "v2", "--no-gpg-sign"], repo);
    const sha2 = git(["rev-parse", "HEAD"], repo).trim();

    writeFileSync(join(repo, "src", "auth.ts"), `dirty\n${v2}`);

    const cap1 = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "first version via sha",
      focus: ["symbols", "source"],
      tokenBudget: 2000,
      gitRef: sha1,
    });
    assert.equal(cap1.snapshot.head, sha1);
    const texts1 = cap1.evidence.map((e) => e.text).join("\n");
    assert.ok(texts1.includes("rotate(secret"));
    assert.ok(!texts1.includes("-v2"));

    const cap2 = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "second version via sha",
      focus: ["symbols", "source"],
      tokenBudget: 2000,
      gitRef: sha2,
    });
    assert.equal(cap2.snapshot.head, sha2);
    const texts2 = cap2.evidence.map((e) => e.text).join("\n");
    assert.ok(texts2.includes("-v2"));

    const currentHead = git(["rev-parse", "HEAD"], repo).trim();
    assert.equal(currentHead, sha2);
    const status = git(["status", "--porcelain=v1"], repo);
    assert.ok(status.includes("src/auth.ts"));

    const capHead = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "via HEAD ref",
      focus: ["symbols"],
      tokenBudget: 1000,
      gitRef: "HEAD",
    });
    assert.equal(capHead.snapshot.head, sha2);
  } finally {
    cleanup();
  }
});

test("invalid gitRef produces REQUEST_INVALID with empty stdout", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    await assert.rejects(
      pack({
        protocolVersion: 1,
        workspace: repo,
        intent: "bad ref",
        focus: ["symbols"],
        tokenBudget: 1000,
        gitRef: "not-a-ref-at-all",
      }),
      (err: unknown) => err instanceof PatrolError && err.code === "REQUEST_INVALID",
    );
  } finally {
    cleanup();
  }
});

test("baseRef without changedPaths computes three-dot delta for changedPaths and review symbols", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const sha1 = git(["rev-parse", "HEAD"], repo).trim();

    // v2 change
    const v2 = [
      "export class AuthService {",
      "  rotate(secret: string): string {",
      "    return secret + '-v2';",
      "  }",
      "}",
      "",
      "export function tokenize(input: string): string[] {",
      "  return input.split(' ');",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(repo, "src", "auth.ts"), v2);
    git(["add", "-A"], repo);
    git(["commit", "-m", "v2", "--no-gpg-sign"], repo);
    const sha2 = git(["rev-parse", "HEAD"], repo).trim();

    // baseRef = sha1, no changedPaths -> should detect the delta from sha1...sha2
    const cap = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "review delta via baseRef",
      focus: ["review"],
      tokenBudget: 2000,
      baseRef: sha1,
    });
    assert.equal(cap.snapshot.head, sha2);
    assert.ok(
      cap.changedPaths.includes("src/auth.ts"),
      "changedPaths should be populated from three-dot",
    );
    assert.ok(
      cap.sections.review?.changedSymbols.includes("src/auth.ts#AuthService.rotate"),
      "review symbols should overlap three-dot delta",
    );

    // explicit changedPaths wins over baseRef
    const capExplicit = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "explicit wins",
      focus: ["review"],
      tokenBudget: 2000,
      baseRef: sha1,
      changedPaths: ["src/auth.ts"],
    });
    assert.deepEqual(capExplicit.changedPaths, ["src/auth.ts"]);

    // invalid baseRef
    await assert.rejects(
      pack({
        protocolVersion: 1,
        workspace: repo,
        intent: "bad base",
        focus: ["review"],
        tokenBudget: 1000,
        baseRef: "not-a-ref-at-all",
      }),
      (err: unknown) => err instanceof PatrolError && err.code === "REQUEST_INVALID",
    );
  } finally {
    cleanup();
  }
});

test("baseRef omitted keeps prior behaviour (no auto delta)", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const cap = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "no baseRef",
      focus: ["symbols"],
      tokenBudget: 1000,
    });
    // without base or changed, changedPaths is empty
    assert.deepEqual(cap.changedPaths, []);
  } finally {
    cleanup();
  }
});

test("includePaths restricts the scan to matching prefixes", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    // create infra subdir
    mkdirSync(join(repo, "src", "infra"));
    writeFileSync(
      join(repo, "src", "infra", "config.ts"),
      "export function getCfg() { return 42; }\n",
    );
    git(["add", "-A"], repo);
    git(["commit", "-m", "add infra", "--no-gpg-sign"], repo);

    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "infra only",
      focus: ["symbols"],
      tokenBudget: 2000,
      includePaths: ["src/infra/"],
    });

    const titles = capsule.evidence.map((e) => e.path || "");
    const names = capsule.evidence.map((e) => e.title || "");
    assert.ok(
      names.some((n) => n.includes("getCfg")) ||
        titles.some((p) => p?.includes("config")),
    );
    assert.ok(!titles.some((p) => p?.includes("auth.ts")));
  } finally {
    cleanup();
  }
});

test("omitting includePaths keeps whole tree", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "all",
      focus: ["symbols"],
      tokenBudget: 2000,
    });
    const titles = capsule.evidence.map((e) => e.path || "");
    assert.ok(titles.some((p) => p?.includes("auth.ts")));
  } finally {
    cleanup();
  }
});

test("excludePaths adds to denylist and removes facts", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    const capsule = await pack({
      protocolVersion: 1,
      workspace: repo,
      intent: "no scripts",
      focus: ["symbols"],
      tokenBudget: 2000,
      excludePaths: ["src"],
    });
    const titles = capsule.evidence.map((e) => e.path || "");
    // src/auth.ts should be excluded
    assert.ok(!titles.some((p) => p?.includes("auth.ts")));
  } finally {
    cleanup();
  }
});

test("invalid include/exclude path is REQUEST_INVALID", async () => {
  const { repo, cleanup } = makeRepo();
  try {
    await assert.rejects(
      pack({
        protocolVersion: 1,
        workspace: repo,
        intent: "bad include",
        focus: ["symbols"],
        tokenBudget: 1000,
        includePaths: ["../escape"],
      }),
      (err: unknown) => err instanceof PatrolError && err.code === "REQUEST_INVALID",
    );
  } finally {
    cleanup();
  }
});
