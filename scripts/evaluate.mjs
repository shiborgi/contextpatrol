import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = join(process.cwd(), "bin", "contextpatrol.js");

function git(args, cwd) {
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

const repo = mkdtempSync(join(tmpdir(), "contextpatrol-eval-"));
const srcDir = join(repo, "src");
mkdirSync(srcDir);

writeFileSync(
  join(repo, "package.json"),
  JSON.stringify({ name: "eval-fixture", version: "1.0.0" }, null, 2),
);
writeFileSync(
  join(srcDir, "auth.ts"),
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
writeFileSync(
  join(srcDir, "index.ts"),
  'export { AuthService, tokenize } from "./auth";\n',
);
writeFileSync(join(repo, ".env"), "SECRET=super-secret-value\n");

// Insight fixture: a hub called by two callers (hub-periphery surprises), one
// Express route, one unused export, and a denied secrets/leak.ts with a route.
mkdirSync(join(repo, "secrets"));
writeFileSync(
  join(srcDir, "hub.ts"),
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
  join(srcDir, "a.ts"),
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
  join(srcDir, "b.ts"),
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
  join(srcDir, "routes.ts"),
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
  join(srcDir, "unused.ts"),
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
git(["config", "user.email", "eval@example.com"], repo);
git(["config", "user.name", "eval"], repo);
git(["add", "-A"], repo);
git(["commit", "-m", "fixture", "--no-gpg-sign"], repo);

const request = {
  protocolVersion: 1,
  workspace: repo,
  intent: "auth token rotation",
  focus: ["architecture", "symbols", "source"],
  tokenBudget: 2000,
};
const requestFile = join(repo, "request.json");
writeFileSync(requestFile, JSON.stringify(request));

const reviewRequest = {
  protocolVersion: 1,
  workspace: repo,
  intent: "auth token rotation",
  focus: ["graph", "review"],
  tokenBudget: 2000,
};
const reviewRequestFile = join(repo, "review-request.json");
writeFileSync(reviewRequestFile, JSON.stringify(reviewRequest));

const insightRequest = {
  protocolVersion: 1,
  workspace: repo,
  intent: "map the graph",
  focus: ["graph"],
  tokenBudget: 4000,
};
const insightRequestFile = join(repo, "insight-request.json");
writeFileSync(insightRequestFile, JSON.stringify(insightRequest));

function run() {
  const out = execFileSync("node", [bin, "pack", "--request", requestFile], {
    encoding: "utf8",
  });
  return JSON.parse(out);
}

function runReview() {
  const out = execFileSync("node", [bin, "pack", "--request", reviewRequestFile], {
    encoding: "utf8",
  });
  return JSON.parse(out);
}

function runInsight() {
  const out = execFileSync("node", [bin, "pack", "--request", insightRequestFile], {
    encoding: "utf8",
  });
  return JSON.parse(out);
}

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push(`  ok  ${name}`);
  } catch (err) {
    checks.push(`FAIL  ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

const first = run();
const second = run();

check("capsule is deterministic", () => {
  if (first.capsuleDigest !== second.capsuleDigest) {
    throw new Error("digests differ across identical runs");
  }
});

check("AuthService symbol recovered", () => {
  const found = first.evidence.some(
    (e) => e.kind === "symbol" && e.title === "AuthService",
  );
  if (!found) {
    throw new Error("AuthService missing from capsule");
  }
});

check("tokenize symbol recovered", () => {
  const found = first.evidence.some(
    (e) => e.kind === "symbol" && e.title === "tokenize",
  );
  if (!found) {
    throw new Error("tokenize missing from capsule");
  }
});

check("budget respected", () => {
  if (first.budget.estimatedTokens > first.budget.requestedTokens) {
    throw new Error("estimatedTokens exceeds requestedTokens");
  }
});

check("secret never leaked", () => {
  const text = JSON.stringify(first);
  if (text.includes("super-secret-value")) {
    throw new Error("secret present in capsule");
  }
});

check("denylist excludes .env", () => {
  const text = JSON.stringify(first);
  if (text.includes(".env")) {
    throw new Error(".env path present in capsule");
  }
});

const reviewCapsule = runReview();

check("graph section present", () => {
  if (!reviewCapsule.sections?.graph) {
    throw new Error("graph section missing");
  }
  if (reviewCapsule.sections.graph.fileCount <= 0) {
    throw new Error("graph.fileCount not positive");
  }
});

check("review section present", () => {
  if (!reviewCapsule.sections?.review) {
    throw new Error("review section missing");
  }
});

check("coverage section present", () => {
  if (!reviewCapsule.sections?.coverage) {
    throw new Error("coverage section missing");
  }
  if (!Array.isArray(reviewCapsule.sections.coverage.unresolvedCalls)) {
    throw new Error("unresolvedCalls is not an array");
  }
});

check("review secret never leaked", () => {
  const text = JSON.stringify(reviewCapsule);
  if (text.includes("super-secret-value")) {
    throw new Error("secret present in review capsule");
  }
  if (text.includes(".env")) {
    throw new Error(".env path present in review capsule");
  }
});

const insightCapsule = runInsight();

check("insight fields populated", () => {
  const graph = insightCapsule.sections?.graph;
  if (!graph) {
    throw new Error("graph section missing");
  }
  if (!Array.isArray(graph.communities) || graph.communities.length === 0) {
    throw new Error("communities empty");
  }
  if (!Array.isArray(graph.routes) || !graph.routes.some((r) => r.path === "/health")) {
    throw new Error("route /health missing");
  }
  if (
    !Array.isArray(graph.deadCode) ||
    !graph.deadCode.some((d) => d.qualifiedName.includes("unusedHelper"))
  ) {
    throw new Error("unusedHelper missing from deadCode");
  }
  if (!Array.isArray(graph.surprises) || graph.surprises.length === 0) {
    throw new Error("surprises empty");
  }
  for (const s of graph.surprises) {
    if (
      !s.from.includes("#") ||
      !s.to.includes("#") ||
      typeof s.score !== "number" ||
      !Array.isArray(s.reasons)
    ) {
      throw new Error("malformed surprise entry");
    }
  }
});

check("insight denylist respected", () => {
  const graph = insightCapsule.sections?.graph;
  if (!graph) {
    throw new Error("graph section missing");
  }
  const routes = graph.routes ?? [];
  if (routes.some((r) => r.path === "/secret")) {
    throw new Error("denied route /secret present");
  }
  const deadCode = graph.deadCode ?? [];
  if (deadCode.some((d) => d.qualifiedName.includes("leakHandler"))) {
    throw new Error("denied leakHandler present in deadCode");
  }
  const text = JSON.stringify(insightCapsule);
  if (text.includes("ghp_secret") || text.includes("secrets/leak.ts")) {
    throw new Error("denied secret present in insight capsule");
  }
});

console.log("evaluate:");
for (const line of checks) {
  console.log(line);
}

rmSync(repo, { recursive: true, force: true });
