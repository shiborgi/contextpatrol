import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";

test("info describes the provider", async () => {
  const result = await runCli(["node", "contextpatrol", "info"], async () =>
    Buffer.alloc(0),
  );
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
