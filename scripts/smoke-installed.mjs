import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" });
}

function git(args, cwd) {
  return run("git", args, cwd);
}

const root = process.cwd();

// Build a fixture repository with a TypeScript symbol.
const repo = mkdtempSync(join(tmpdir(), "contextpatrol-fixture-"));
mkdirSync(join(repo, "src"));
writeFileSync(
  join(repo, "package.json"),
  JSON.stringify({ name: "fixture", version: "1.0.0" }),
);
writeFileSync(
  join(repo, "src", "auth.ts"),
  "export class AuthService {\n  rotate(s: string): string { return s; }\n}\n",
);
git(["init", "-b", "main"], repo);
git(["config", "user.email", "smoke@example.com"], repo);
git(["config", "user.name", "smoke"], repo);
git(["add", "-A"], repo);
git(["commit", "-m", "fixture", "--no-gpg-sign"], repo);

// Pack and install the package.
const packDir = mkdtempSync(join(tmpdir(), "contextpatrol-pack-"));
run("npm", ["pack", "--pack-destination", packDir, "--silent"], root);
const tarball = join(packDir, `contextpatrol-${pkg.version}.tgz`);

const installDir = mkdtempSync(join(tmpdir(), "contextpatrol-install-"));
writeFileSync(join(installDir, "package.json"), '{"name":"probe","version":"1.0.0"}');
run("npm", ["install", tarball, "--no-audit", "--no-fund"], installDir);

const bin = join(installDir, "node_modules", ".bin", "contextpatrol");

const version = run(bin, ["--version"], installDir).trim();
if (version !== pkg.version) {
  console.error(`expected version ${pkg.version}, got ${version}`);
  process.exit(1);
}

const protocol = JSON.parse(run(bin, ["protocol"], installDir));
if (protocol.provider !== "contextpatrol" || protocol.protocolVersion !== 1) {
  console.error(`unexpected descriptor: ${JSON.stringify(protocol)}`);
  process.exit(1);
}

// Run a real pack from a neutral CWD (the install dir, outside the repo).
const requestFile = join(installDir, "request.json");
writeFileSync(
  requestFile,
  JSON.stringify({
    protocolVersion: 1,
    workspace: repo,
    intent: "auth",
    focus: ["symbols"],
    tokenBudget: 800,
  }),
);
const capsule = JSON.parse(run(bin, ["pack", "--request", requestFile], installDir));
const recovered = capsule.evidence.some((e) => e.title === "AuthService");
if (!recovered) {
  console.error("installed pack did not recover the expected symbol");
  process.exit(1);
}

console.log(`smoke-installed: ok (tarball installs, runs protocol and a real pack)`);
rmSync(repo, { recursive: true, force: true });
rmSync(packDir, { recursive: true, force: true });
rmSync(installDir, { recursive: true, force: true });
