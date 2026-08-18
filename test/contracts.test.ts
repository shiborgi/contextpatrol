import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  capsuleSchema,
  descriptor,
  errorSchema,
  packRequestSchema,
} from "../src/contracts.js";

function fixtures(group: string): Array<{ name: string; data: unknown }> {
  const dir = join(process.cwd(), "protocol", "fixtures", group);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((name) => ({ name, data: JSON.parse(readFileSync(join(dir, name), "utf8")) }));
}

test("descriptor matches protocol v1", () => {
  const d = descriptor();
  assert.equal(d.provider, "contextpatrol");
  assert.equal(d.protocolVersion, 1);
  assert.deepEqual(d.focusValues, [
    "architecture",
    "symbols",
    "source",
    "graph",
    "review",
  ]);
  assert.ok(d.features.includes("pack"));
});

test("valid pack-request fixtures are accepted", () => {
  for (const { name, data } of fixtures("valid")) {
    if (!name.startsWith("pack-request")) {
      continue;
    }
    const result = packRequestSchema.safeParse(data);
    assert.equal(result.success, true, `${name}: ${JSON.stringify(result)}`);
  }
});

test("invalid pack-request fixtures are rejected", () => {
  for (const { name, data } of fixtures("invalid")) {
    if (!name.startsWith("pack-request")) {
      continue;
    }
    const result = packRequestSchema.safeParse(data);
    assert.equal(result.success, false, `${name} should be rejected`);
  }
});

test("valid capsule fixture is accepted", () => {
  for (const { name, data } of fixtures("valid")) {
    if (!name.startsWith("capsule")) {
      continue;
    }
    assert.equal(capsuleSchema.safeParse(data).success, true, name);
  }
});

test("error schema accepts a valid error", () => {
  const result = errorSchema.safeParse({ error: "INTERNAL", message: "boom" });
  assert.equal(result.success, true);
});

test("pack-request rejects lifecycle vocabulary", () => {
  const result = packRequestSchema.safeParse({
    protocolVersion: 1,
    workspace: "/repo",
    intent: "x",
    focus: ["symbols"],
    tokenBudget: 800,
    stage: "plan",
  });
  assert.equal(result.success, false);
});
