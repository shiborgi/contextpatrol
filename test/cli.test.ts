import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";

async function emptyStdin(): Promise<Buffer> {
  return Buffer.alloc(0);
}

async function captureStderrAround(action: () => Promise<void>): Promise<string> {
  const original = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    await action();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}

test("info describes the provider", async () => {
  const result = await runCli(["node", "contextpatrol", "info"], emptyStdin);
  assert.equal(result.exitCode, 0);
  const info = JSON.parse(result.stdout);
  assert.equal(info.provider.name, "contextpatrol");
  assert.deepEqual(info.query.argv, ["query", "--input", "FILE|-"]);
});

test("query rejects lifecycle vocabulary", async () => {
  const result = await runCli(
    ["node", "contextpatrol", "query", "--input", "-"],
    async () =>
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          workspace: "/tmp/project",
          query: "x",
          facets: ["symbols"],
          maxOutputBytes: 1024,
          target: { kind: "working-tree" },
          stage: "anything",
        }),
      ),
  );
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unknown properties: stage/);
});

test("--help documents mutually exclusive globals", async () => {
  const result = await runCli(["node", "contextpatrol", "--help"], emptyStdin);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Global: --verbose, --quiet, --help, --version/);
});

test("--verbose and --quiet are mutually exclusive", async () => {
  for (const argv of [
    ["node", "contextpatrol", "--verbose", "--quiet", "info"],
    ["node", "contextpatrol", "--quiet", "--verbose", "info"],
    ["node", "contextpatrol", "info", "--verbose", "--quiet"],
  ]) {
    const result = await runCli(argv, emptyStdin);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    const parsed = JSON.parse(result.stderr) as {
      error: string;
      message: string;
    };
    assert.equal(parsed.error, "USAGE");
    assert.match(parsed.message, /--verbose and --quiet cannot be combined/);
    assert.deepEqual(Object.keys(parsed).sort(), ["error", "message"]);
  }
});

test("info stdout is byte-identical with and without --verbose", async () => {
  const plain = await runCli(["node", "contextpatrol", "info"], emptyStdin);
  let verbose: Awaited<ReturnType<typeof runCli>> | undefined;
  let trailing: Awaited<ReturnType<typeof runCli>> | undefined;
  await captureStderrAround(async () => {
    verbose = await runCli(["node", "contextpatrol", "--verbose", "info"], emptyStdin);
    trailing = await runCli(["node", "contextpatrol", "info", "--verbose"], emptyStdin);
  });
  assert.ok(verbose);
  assert.ok(trailing);
  assert.equal(plain.exitCode, 0);
  assert.equal(verbose.exitCode, 0);
  assert.equal(trailing.exitCode, 0);
  assert.equal(verbose.stdout, plain.stdout);
  assert.equal(trailing.stdout, plain.stdout);
  assert.equal(plain.stderr, "");
  assert.equal(verbose.stderr, "");
  assert.equal(trailing.stderr, "");
});

test("--verbose writes [contextpatrol] debug lines to process.stderr", async () => {
  let verbose: { exitCode: number; stdout: string; stderr: string } | undefined;
  const verboseLog = await captureStderrAround(async () => {
    verbose = await runCli(["node", "contextpatrol", "--verbose", "info"], emptyStdin);
  });
  assert.ok(verbose);
  assert.equal(verbose.exitCode, 0);
  assert.equal(verbose.stderr, "");
  assert.match(verboseLog, /\[contextpatrol\] debug: /);

  const quietLog = await captureStderrAround(async () => {
    await runCli(["node", "contextpatrol", "--quiet", "info"], emptyStdin);
  });
  assert.equal(quietLog, "");

  const defaultLog = await captureStderrAround(async () => {
    await runCli(["node", "contextpatrol", "info"], emptyStdin);
  });
  assert.doesNotMatch(defaultLog, /\[contextpatrol\] debug: /);
});

test("JSON errors remain {error,message} on stderr with empty stdout", async () => {
  const missingInput = await runCli(["node", "contextpatrol", "query"], emptyStdin);
  assert.equal(missingInput.exitCode, 2);
  assert.equal(missingInput.stdout, "");
  const missing = JSON.parse(missingInput.stderr) as {
    error: string;
    message: string;
  };
  assert.equal(missing.error, "USAGE");
  assert.equal(typeof missing.message, "string");
  assert.deepEqual(Object.keys(missing).sort(), ["error", "message"]);

  const extraInfo = await runCli(
    ["node", "contextpatrol", "info", "extra"],
    emptyStdin,
  );
  assert.equal(extraInfo.exitCode, 2);
  assert.equal(extraInfo.stdout, "");
  const extra = JSON.parse(extraInfo.stderr) as {
    error: string;
    message: string;
  };
  assert.equal(extra.error, "USAGE");
  assert.deepEqual(Object.keys(extra).sort(), ["error", "message"]);

  const extraQuery = await runCli(
    ["node", "contextpatrol", "query", "--input", "-", "extra"],
    emptyStdin,
  );
  assert.equal(extraQuery.exitCode, 2);
  assert.equal(extraQuery.stdout, "");
  const queryExtra = JSON.parse(extraQuery.stderr) as {
    error: string;
    message: string;
  };
  assert.equal(queryExtra.error, "USAGE");
  assert.match(queryExtra.message, /expected query --input FILE\|-/);
  assert.deepEqual(Object.keys(queryExtra).sort(), ["error", "message"]);

  const verboseUsage = await runCli(
    ["node", "contextpatrol", "--verbose", "query"],
    emptyStdin,
  );
  assert.equal(verboseUsage.exitCode, 2);
  assert.equal(verboseUsage.stdout, "");
  const verboseParsed = JSON.parse(verboseUsage.stderr) as {
    error: string;
    message: string;
  };
  assert.equal(verboseParsed.error, "USAGE");
  assert.deepEqual(Object.keys(verboseParsed).sort(), ["error", "message"]);
});
