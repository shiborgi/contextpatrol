import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { queryContext } from "../src/analyze.js";
import type { ContextReport, Facet, SourceDepth } from "../src/types.js";

interface ProfileRecipe {
  facets: Facet[];
  maxOutputBytes: number;
  sourceDepth?: SourceDepth;
}

interface Config {
  contextPatrol: {
    profiles: Record<string, ProfileRecipe>;
    defaults: Record<string, string>;
  };
}

const stageTypedRecipes: Record<string, ProfileRecipe> = {
  readiness: {
    facets: ["changes", "tests", "relations"],
    maxOutputBytes: 9600,
  },
  "spec-survey": {
    facets: ["structure", "symbols", "source"],
    maxOutputBytes: 12800,
    sourceDepth: "signatures",
  },
  "spec-deep": {
    facets: ["structure", "symbols", "relations"],
    maxOutputBytes: 19200,
  },
  "plan-impact": {
    facets: ["changes", "symbols", "relations", "tests"],
    maxOutputBytes: 19200,
  },
  "plan-deep": {
    facets: ["changes", "symbols", "relations", "source", "tests"],
    maxOutputBytes: 24000,
  },
  "build-work": {
    facets: ["symbols", "source", "tests"],
    maxOutputBytes: 19200,
  },
  "build-deep": {
    facets: ["symbols", "relations", "source", "tests"],
    maxOutputBytes: 24000,
  },
  "review-diff": {
    facets: ["changes", "symbols", "relations", "tests"],
    maxOutputBytes: 12800,
  },
  "review-grounded": {
    facets: ["changes", "symbols", "relations", "source", "tests"],
    maxOutputBytes: 19200,
  },
};

const stageTypedDefaults = {
  spec: "spec-survey",
  "spec-review": "spec-deep",
  plan: "plan-deep",
  "plan-review": "review-diff",
  build: "build-work",
  "build-review": "review-grounded",
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

function requestFor(
  recipe: ProfileRecipe,
  workspace: string,
  baseline: string,
  target: string,
) {
  return {
    schemaVersion: 1 as const,
    workspace,
    query: "validate token authorize",
    facets: [...recipe.facets],
    maxOutputBytes: recipe.maxOutputBytes,
    target: { kind: "commit" as const, oid: target },
    baseline: { oid: baseline },
    ...(recipe.sourceDepth ? { sourceDepth: recipe.sourceDepth } : {}),
  };
}

test("stage-typed catalog is exact", () => {
  const config = loadConfig();
  assert.deepEqual(
    Object.keys(config.contextPatrol.profiles).sort(),
    Object.keys(stageTypedRecipes).sort(),
  );
  for (const [name, recipe] of Object.entries(stageTypedRecipes)) {
    assert.deepEqual(config.contextPatrol.profiles[name], recipe);
  }
});

test("stage-typed defaults are resolvable", () => {
  const config = loadConfig();
  assert.deepEqual(config.contextPatrol.defaults, stageTypedDefaults);
  for (const profileName of Object.values(config.contextPatrol.defaults)) {
    assert.ok(config.contextPatrol.profiles[profileName]);
  }
});

for (const [name, expectedRecipe] of Object.entries(stageTypedRecipes)) {
  test(`${name} is bounded and repeatable`, async () => {
    const config = loadConfig();
    const recipe = config.contextPatrol.profiles[name];
    assert.deepEqual(recipe, expectedRecipe);
    const { workspace, baseline, target } = createFixtureRepository();
    try {
      const request = requestFor(recipe, workspace, baseline, target);
      const first = await queryContext(request);
      const second = await queryContext({
        ...request,
        facets: [...recipe.facets],
      });
      assert.deepEqual(first, second);
      assert.equal(first.reportDigest, second.reportDigest);
      assert.equal(first.budget.maxOutputBytes, expectedRecipe.maxOutputBytes);
      assert.ok(first.budget.outputBytes >= 1);
      assert.ok(first.budget.outputBytes <= expectedRecipe.maxOutputBytes);
      assertPublicReport(first);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
}

test("stage-typed reports are facet-specific", async () => {
  const config = loadConfig();
  const { workspace, baseline, target } = createFixtureRepository();
  try {
    const reports = new Map<string, ContextReport>();
    for (const [name, recipe] of Object.entries(stageTypedRecipes)) {
      assert.deepEqual(config.contextPatrol.profiles[name], recipe);
      const request = requestFor(recipe, workspace, baseline, target);
      const first = await queryContext(request);
      const second = await queryContext({
        ...request,
        facets: [...recipe.facets],
      });
      assert.deepEqual(first, second, `${name} report is not repeatable`);
      assertPublicReport(first);
      reports.set(name, first);
    }

    const specSurvey = reports.get("spec-survey");
    const specDeep = reports.get("spec-deep");
    const planImpact = reports.get("plan-impact");
    const planDeep = reports.get("plan-deep");
    const buildWork = reports.get("build-work");
    const buildDeep = reports.get("build-deep");
    const reviewDiff = reports.get("review-diff");
    const reviewGrounded = reports.get("review-grounded");
    const readiness = reports.get("readiness");
    assert.ok(specSurvey);
    assert.ok(specDeep);
    assert.ok(planImpact);
    assert.ok(planDeep);
    assert.ok(buildWork);
    assert.ok(buildDeep);
    assert.ok(reviewDiff);
    assert.ok(reviewGrounded);
    assert.ok(readiness);

    assert.ok(specSurvey.files.length > 0);
    assert.ok(specSurvey.symbols.length > 0);
    assert.ok(specSurvey.snippets.length > 0);
    assert.deepEqual(specSurvey.relations, []);
    assert.deepEqual(specSurvey.changes, []);
    assert.deepEqual(specSurvey.tests, {
      files: [],
      changedSourceWithoutTest: [],
    });

    assert.ok(specDeep.files.length > 0);
    assert.ok(specDeep.symbols.length > 0);
    assert.ok(specDeep.relations.length > 0);
    assert.deepEqual(specDeep.snippets, []);
    assert.deepEqual(specDeep.changes, []);

    const expectedChanges = [
      { path: "src/token.js", status: "modified" as const },
      { path: "src/untested.ts", status: "added" as const },
    ];
    const expectedTests = {
      files: ["src/token.test.ts"],
      changedSourceWithoutTest: ["src/untested.ts"],
    };

    assert.deepEqual(planImpact.files, []);
    assert.deepEqual(planImpact.snippets, []);
    assert.deepEqual(planImpact.changes, expectedChanges);
    assert.deepEqual(planImpact.tests, expectedTests);

    assert.deepEqual(planDeep.files, []);
    assert.ok(planDeep.snippets.length > 0);
    assert.deepEqual(planDeep.changes, expectedChanges);
    assert.deepEqual(planDeep.tests, expectedTests);

    assert.deepEqual(buildWork.files, []);
    assert.deepEqual(buildWork.relations, []);
    assert.ok(buildWork.snippets.length > 0);
    assert.deepEqual(buildWork.changes, []);
    assert.deepEqual(buildWork.tests, expectedTests);

    assert.deepEqual(buildDeep.files, []);
    assert.ok(buildDeep.relations.length > 0);
    assert.ok(buildDeep.snippets.length > 0);
    assert.deepEqual(buildDeep.changes, []);
    assert.deepEqual(buildDeep.tests, expectedTests);

    assert.deepEqual(reviewDiff.files, []);
    assert.deepEqual(reviewDiff.snippets, []);
    assert.deepEqual(reviewDiff.changes, expectedChanges);
    assert.deepEqual(reviewDiff.tests, expectedTests);

    assert.deepEqual(reviewGrounded.files, []);
    assert.ok(reviewGrounded.snippets.length > 0);
    assert.deepEqual(reviewGrounded.changes, expectedChanges);
    assert.deepEqual(reviewGrounded.tests, expectedTests);

    assert.deepEqual(readiness.files, []);
    assert.deepEqual(readiness.symbols, []);
    assert.deepEqual(readiness.snippets, []);
    assert.deepEqual(readiness.changes, expectedChanges);
    assert.deepEqual(readiness.tests, expectedTests);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
