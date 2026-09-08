import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalJson, digest, query } from "../dist/src/index.js";

const root = await mkdtemp(path.join(os.tmpdir(), "contextpatrol-smoke-"));
try {
  await writeFile(
    path.join(root, "form.tsx"),
    'import React from "react"; export const Form = () => <form />;',
  );
  const report = await query({
    protocolVersion: "1.0",
    root,
    task: "React form",
    profile: "implementation",
    budget: { maxBytes: 2048 },
  });
  assert.equal(report.protocolVersion, "1.0");
  assert.ok(report.signals.includes("react"));
  assert.ok(report.files.some((file) => file.path === "form.tsx"));
  assert.ok(Buffer.byteLength(canonicalJson(report)) + 1 <= 2048);
  const { digest: actual, ...payload } = report;
  assert.equal(actual, digest(payload));
  process.stdout.write("Patrol Protocol 1.0 library smoke passed\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
