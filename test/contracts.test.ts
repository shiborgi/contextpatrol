import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { SOURCE_DEPTHS } from "../src/constants.js";
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

test("legacy requests without sourceDepth or ranking validate unchanged", () => {
  const parsed = validateQueryRequest(request);
  assert.equal(parsed.sourceDepth, undefined);
  assert.equal(parsed.ranking, undefined);
  assert.deepEqual(Object.keys(parsed), [
    "schemaVersion",
    "workspace",
    "query",
    "facets",
    "maxOutputBytes",
    "target",
  ]);
});

test("sourceDepth accepts only the published depths", () => {
  for (const depth of ["full", "signatures", "listing"]) {
    assert.equal(
      validateQueryRequest({ ...request, sourceDepth: depth }).sourceDepth,
      depth,
    );
  }
  assert.throws(
    () => validateQueryRequest({ ...request, sourceDepth: "headers" }),
    /sourceDepth must be one of/,
  );
  assert.throws(
    () => validateQueryRequest({ ...request, sourceDepth: "" }),
    /sourceDepth must be a non-empty string/,
  );
});

test("ranking accepts bounded unique string arrays", () => {
  const parsed = validateQueryRequest({
    ...request,
    ranking: {
      boostIdents: ["token", "validate"],
      boostPaths: ["src"],
      dampenPaths: ["vendor"],
    },
  });
  assert.deepEqual(parsed.ranking, {
    boostIdents: ["token", "validate"],
    boostPaths: ["src"],
    dampenPaths: ["vendor"],
  });
  assert.deepEqual(Object.keys(parsed.ranking ?? {}), [
    "boostIdents",
    "boostPaths",
    "dampenPaths",
  ]);
});

test("ranking rejects empty-string and duplicate entries", () => {
  assert.throws(
    () => validateQueryRequest({ ...request, ranking: { boostIdents: [""] } }),
    /ranking\.boostIdents\.0 must be a non-empty string/,
  );
  assert.throws(
    () => validateQueryRequest({ ...request, ranking: { boostIdents: ["a", "a"] } }),
    /ranking\.boostIdents must not contain duplicates/,
  );
});

test("ranking rejects oversized arrays and entries", () => {
  const tooMany = Array.from({ length: 51 }, (_, index) => `ident${index}`);
  assert.throws(
    () => validateQueryRequest({ ...request, ranking: { boostIdents: tooMany } }),
    /at most 50 entries/,
  );
  assert.throws(
    () =>
      validateQueryRequest({ ...request, ranking: { boostPaths: ["x".repeat(129)] } }),
    /exceeds 128 UTF-8 bytes/,
  );
});

test("ranking rejects unknown keys and non-object values", () => {
  assert.throws(
    () =>
      validateQueryRequest({ ...request, ranking: { boostIdents: [], extra: true } }),
    /unknown properties: extra/,
  );
  assert.throws(
    () => validateQueryRequest({ ...request, ranking: ["src"] }),
    /ranking must be an object/,
  );
  assert.throws(
    () => validateQueryRequest({ ...request, ranking: { boostIdents: "src" } }),
    /ranking\.boostIdents must be an array/,
  );
});

test("includeSectionDigests is optional, strict, and normalizes false to omission", () => {
  assert.equal(
    validateQueryRequest({ ...request, includeSectionDigests: true })
      .includeSectionDigests,
    true,
  );
  assert.equal(
    validateQueryRequest({ ...request, includeSectionDigests: false })
      .includeSectionDigests,
    undefined,
  );
  assert.equal(validateQueryRequest(request).includeSectionDigests, undefined);
  assert.throws(
    () => validateQueryRequest({ ...request, includeSectionDigests: "yes" }),
    /includeSectionDigests must be a boolean/,
  );
  assert.throws(
    () => validateQueryRequest({ ...request, includeSectionDigests: 1 }),
    /includeSectionDigests must be a boolean/,
  );
  assert.throws(
    () => validateQueryRequest({ ...request, includeSectionDigest: true }),
    /unknown properties: includeSectionDigest/,
  );
});

test("normalized public request excludes orchestration and selection fields", () => {
  for (const field of ["lifecycle", "execution", "candidate", "score", "selection"]) {
    assert.throws(
      () => validateQueryRequest({ ...request, [field]: "x" }),
      new RegExp(`unknown properties: ${field}`),
    );
  }
  const parsed = validateQueryRequest(request);
  const keys = Object.keys(parsed);
  for (const forbidden of [
    "lifecycle",
    "execution",
    "candidate",
    "score",
    "ranking",
    "selection",
  ]) {
    assert.ok(!keys.includes(forbidden), `${forbidden} must not appear in the request`);
  }
});

test("published JSON schema round-trips with contracts.ts", () => {
  const schema = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "schemas", "query-request.schema.json"),
      "utf8",
    ),
  );
  assert.deepEqual(schema.required, [
    "schemaVersion",
    "workspace",
    "query",
    "facets",
    "maxOutputBytes",
    "target",
  ]);
  assert.deepEqual(schema.properties.sourceDepth.enum, [...SOURCE_DEPTHS]);
  assert.deepEqual(schema.properties.includeSectionDigests, { type: "boolean" });
  assert.equal(schema.properties.ranking.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties.ranking.properties).sort(), [
    "boostIdents",
    "boostPaths",
    "dampenPaths",
  ]);
  for (const key of ["boostIdents", "boostPaths", "dampenPaths"]) {
    const property = schema.properties.ranking.properties[key];
    assert.equal(property.type, "array");
    assert.equal(property.maxItems, 50);
    assert.equal(property.uniqueItems, true);
    assert.deepEqual(property.items, { type: "string", minLength: 1, maxLength: 128 });
  }
  const accepted = [
    validateQueryRequest(request),
    validateQueryRequest({ ...request, sourceDepth: "signatures" }),
    validateQueryRequest({
      ...request,
      ranking: { boostIdents: ["token"], boostPaths: ["src"], dampenPaths: ["vendor"] },
    }),
    validateQueryRequest({ ...request, includeSectionDigests: true }),
  ];
  for (const parsed of accepted) {
    for (const key of Object.keys(parsed)) {
      assert.ok(key in schema.properties, `${key} must be declared by the schema`);
    }
  }
});
