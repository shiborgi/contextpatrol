import assert from "node:assert/strict";
import test from "node:test";
import { validateQueryRequest } from "../src/contracts.js";

const request = {
  schemaVersion: 1,
  workspace: "/tmp/project",
  query: "inspect token handling",
  facets: ["source", "symbols"],
  maxOutputBytes: 2048,
  target: { kind: "working-tree" },
};

test("query request is strict and canonicalizes facets", () => {
  assert.deepEqual(validateQueryRequest(request).facets, ["symbols", "source"]);
  assert.throws(
    () => validateQueryRequest({ ...request, operation: "build" }),
    /unknown properties: operation/,
  );
  assert.throws(
    () => validateQueryRequest({ ...request, includePaths: ["../secret"] }),
    /safe repository-relative path/,
  );
});
