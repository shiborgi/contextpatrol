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

function run() {
  const out = execFileSync("node", [bin, "pack", "--request", requestFile], {
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

console.log("evaluate:");
for (const line of checks) {
  console.log(line);
}

rmSync(repo, { recursive: true, force: true });
