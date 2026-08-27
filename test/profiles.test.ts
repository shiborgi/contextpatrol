import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { queryContext } from "../src/analyze.js";
import type { ContextReport, Facet } from "../src/types.js";

interface ProfileRecipe {
  facets: Facet[];
  maxOutputBytes: number;
}

interface Config {
  contextPatrol: {
    profiles: Record<string, ProfileRecipe>;
    defaults: Record<string, string>;
  };
}

const expectedRecipes: Record<string, ProfileRecipe> = {
  "orientation-wide": {
    facets: ["structure", "symbols", "relations"],
    maxOutputBytes: 19200,
  },
  "orientation-grounded": {
    facets: ["structure", "symbols", "relations", "source"],
    maxOutputBytes: 19200,
  },
  "implementation-deep": {
    facets: ["symbols", "relations", "source", "tests"],
    maxOutputBytes: 24000,
  },
  "impact-wide": {
    facets: ["changes", "symbols", "relations", "tests"],
    maxOutputBytes: 24000,
  },
  "impact-grounded": {
    facets: ["changes", "symbols", "relations", "source", "tests"],
    maxOutputBytes: 24000,
  },
};

const existingProfiles: Record<string, ProfileRecipe> = {
  orientation: {
    facets: ["structure", "symbols", "relations"],
    maxOutputBytes: 9600,
  },
  implementation: {
    facets: ["symbols", "relations", "source", "tests"],
    maxOutputBytes: 14400,
  },
  impact: {
    facets: ["changes", "symbols", "relations", "tests"],
    maxOutputBytes: 14400,
  },
  readiness: {
    facets: ["changes", "tests", "relations"],
    maxOutputBytes: 9600,
  },
};

const existingDefaults = {
  spec: "orientation",
  "spec-review": "orientation",
  plan: "implementation",
  "plan-review": "impact",
  build: "implementation",
  "build-review": "impact",
  ship: "readiness",
};

const publicReportKeys = [
  "schemaVersion",
  "provider",
  "requestDigest",
  "reportDigest",
  "target",
  "budget",
  "summary",
  "files",
  "symbols",
  "relations",
  "changes",
  "tests",
  "snippets",
  "coverage",
];

function loadConfig(): Config {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "codepatrol.json"), "utf8"),
  ) as Config;
}

function git(workspace: string, args: string[]): string {
  return execFileSync("git", ["-C", workspace, ...args], {
    encoding: "utf8",
  }).trim();
}

function createFixtureRepository(): {
  workspace: string;
  baseline: string;
  target: string;
} {
  const workspace = mkdtempSync(path.join(tmpdir(), "contextpatrol-wave-5-1-"));
  const fixtureRoot = path.join(process.cwd(), "test", "fixtures", "wave-5-1");
  cpSync(path.join(fixtureRoot, "base"), workspace, { recursive: true });
  git(workspace, ["init", "-q"]);
  git(workspace, ["config", "user.email", "test@example.com"]);
  git(workspace, ["config", "user.name", "ContextPatrol Test"]);
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-qm", "fixed fixture base"]);
  const baseline = git(workspace, ["rev-parse", "HEAD"]);
  cpSync(path.join(fixtureRoot, "target"), workspace, { recursive: true });
  git(workspace, ["add", "."]);
  git(workspace, ["commit", "-qm", "fixed fixture target"]);
  const target = git(workspace, ["rev-parse", "HEAD"]);
  return { workspace, baseline, target };
}

function assertNoOrchestrationData(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoOrchestrationData(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, /lifecycle|caller|agent/i);
    assertNoOrchestrationData(child);
  }
}

function assertPublicReport(report: ContextReport): void {
  assert.deepEqual(Object.keys(report).sort(), [...publicReportKeys].sort());
  assertNoOrchestrationData(report);
  assert.doesNotMatch(JSON.stringify(report), /lifecycle|caller|agent/i);
}

test("WAVE-5.1 recipes are additive and exact", () => {
  const config = loadConfig();
  assert.deepEqual(config.contextPatrol.profiles, {
    ...existingProfiles,
    ...expectedRecipes,
  });
  assert.deepEqual(config.contextPatrol.defaults, existingDefaults);
});

test("WAVE-5.1 reports are repeatable, bounded, and facet-specific", async () => {
  const config = loadConfig();
  const recipes: Record<string, ProfileRecipe> = {};
  for (const name of Object.keys(expectedRecipes)) {
    const recipe = config.contextPatrol.profiles[name];
    assert.ok(recipe, `missing configured recipe: ${name}`);
    recipes[name] = recipe;
  }
  const { workspace, baseline, target } = createFixtureRepository();
  try {
    const reports = new Map<string, ContextReport>();
    for (const [name, recipe] of Object.entries(recipes)) {
      const request = {
        schemaVersion: 1 as const,
        workspace,
        query: "validate token authorize",
        facets: [...recipe.facets],
        maxOutputBytes: recipe.maxOutputBytes,
        target: { kind: "commit" as const, oid: target },
        baseline: { oid: baseline },
      };
      const first = await queryContext(request);
      const second = await queryContext({ ...request, facets: [...recipe.facets] });
      assert.deepEqual(first, second, `${name} report is not repeatable`);
      assert.equal(first.reportDigest, second.reportDigest);
      assert.equal(first.budget.maxOutputBytes, recipe.maxOutputBytes);
      assert.ok(first.budget.outputBytes >= 1);
      assert.ok(first.budget.outputBytes <= recipe.maxOutputBytes);
      assertPublicReport(first);
      reports.set(name, first);
    }

    const orientationWide = reports.get("orientation-wide");
    const orientationGrounded = reports.get("orientation-grounded");
    const implementationDeep = reports.get("implementation-deep");
    const impactWide = reports.get("impact-wide");
    const impactGrounded = reports.get("impact-grounded");
    assert.ok(orientationWide);
    assert.ok(orientationGrounded);
    assert.ok(implementationDeep);
    assert.ok(impactWide);
    assert.ok(impactGrounded);

    assert.ok(orientationWide.files.length > 0);
    assert.ok(orientationWide.symbols.length > 0);
    assert.ok(orientationWide.relations.length > 0);
    assert.deepEqual(orientationWide.snippets, []);
    assert.deepEqual(orientationWide.changes, []);
    assert.deepEqual(orientationWide.tests, {
      files: [],
      changedSourceWithoutTest: [],
    });

    assert.ok(orientationGrounded.snippets.length > 0);
    assert.deepEqual(orientationGrounded.changes, []);
    assert.deepEqual(orientationGrounded.tests, {
      files: [],
      changedSourceWithoutTest: [],
    });

    assert.deepEqual(implementationDeep.files, []);
    assert.ok(implementationDeep.symbols.length > 0);
    assert.ok(implementationDeep.relations.length > 0);
    assert.ok(implementationDeep.snippets.length > 0);
    assert.deepEqual(implementationDeep.changes, []);
    assert.deepEqual(implementationDeep.tests, {
      files: ["src/token.test.ts"],
      changedSourceWithoutTest: ["src/untested.ts"],
    });

    const expectedChanges = [
      { path: "src/token.js", status: "modified" as const },
      { path: "src/untested.ts", status: "added" as const },
    ];
    assert.deepEqual(impactWide.files, []);
    assert.deepEqual(impactWide.snippets, []);
    assert.deepEqual(impactWide.changes, expectedChanges);
    assert.deepEqual(impactWide.tests, implementationDeep.tests);

    assert.deepEqual(impactGrounded.files, []);
    assert.ok(impactGrounded.snippets.length > 0);
    assert.deepEqual(impactGrounded.changes, expectedChanges);
    assert.deepEqual(impactGrounded.tests, implementationDeep.tests);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
