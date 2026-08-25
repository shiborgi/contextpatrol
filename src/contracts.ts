import path from "node:path";
import { FACETS, LIMITS, SCHEMA_VERSION } from "./constants.js";
import { ContextPatrolError } from "./errors.js";
import { exactKeys, isRecord } from "./json.js";
import type { Facet, QueryRequest } from "./types.js";

const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function oid(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (!OID.test(parsed))
    throw new Error(`${label} must be a full lowercase object id`);
  return parsed;
}

function paths(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > LIMITS.maxPaths)
    throw new Error(
      `${label} must be an array with at most ${LIMITS.maxPaths} paths`,
    );
  const parsed = value.map((item, index) => {
    const itemText = text(item, `${label}.${index}`);
    if (
      path.isAbsolute(itemText) ||
      itemText.includes("\\") ||
      itemText
        .split("/")
        .some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error(
        `${label}.${index} must be a safe repository-relative path`,
      );
    }
    return itemText;
  });
  if (new Set(parsed).size !== parsed.length)
    throw new Error(`${label} must not contain duplicates`);
  return parsed;
}

export function validateQueryRequest(value: unknown): QueryRequest {
  try {
    if (!isRecord(value)) throw new Error("query request must be an object");
    exactKeys(
      value,
      [
        "schemaVersion",
        "workspace",
        "query",
        "facets",
        "maxOutputBytes",
        "target",
        "baseline",
        "includePaths",
        "excludePaths",
      ],
      [
        "schemaVersion",
        "workspace",
        "query",
        "facets",
        "maxOutputBytes",
        "target",
      ],
      "query request",
    );
    if (value.schemaVersion !== SCHEMA_VERSION)
      throw new Error("query request.schemaVersion must be 1");
    const workspace = text(value.workspace, "query request.workspace");
    if (!path.isAbsolute(workspace))
      throw new Error("query request.workspace must be absolute");
    const query = text(value.query, "query request.query");
    if (Buffer.byteLength(query, "utf8") > LIMITS.maxQueryBytes)
      throw new Error(
        `query request.query exceeds ${LIMITS.maxQueryBytes} bytes`,
      );
    if (!Array.isArray(value.facets) || value.facets.length === 0)
      throw new Error("query request.facets must be a non-empty array");
    const facets = value.facets.map((facet) => {
      if (typeof facet !== "string" || !FACETS.includes(facet as Facet))
        throw new Error(
          `query request.facets contains an unsupported facet: ${String(facet)}`,
        );
      return facet as Facet;
    });
    if (new Set(facets).size !== facets.length)
      throw new Error("query request.facets must not contain duplicates");
    facets.sort((left, right) => FACETS.indexOf(left) - FACETS.indexOf(right));
    if (
      typeof value.maxOutputBytes !== "number" ||
      !Number.isInteger(value.maxOutputBytes) ||
      value.maxOutputBytes < LIMITS.minOutputBytes ||
      value.maxOutputBytes > LIMITS.maxOutputBytes
    ) {
      throw new Error(
        `query request.maxOutputBytes must be an integer from ${LIMITS.minOutputBytes} to ${LIMITS.maxOutputBytes}`,
      );
    }
    if (!isRecord(value.target))
      throw new Error("query request.target must be an object");
    if (value.target.kind === "working-tree") {
      exactKeys(value.target, ["kind"], ["kind"], "query request.target");
    } else if (value.target.kind === "commit") {
      exactKeys(
        value.target,
        ["kind", "oid"],
        ["kind", "oid"],
        "query request.target",
      );
      oid(value.target.oid, "query request.target.oid");
    } else {
      throw new Error(
        "query request.target.kind must be working-tree or commit",
      );
    }
    let baseline: { oid: string } | undefined;
    if (value.baseline !== undefined) {
      if (!isRecord(value.baseline))
        throw new Error("query request.baseline must be an object");
      exactKeys(value.baseline, ["oid"], ["oid"], "query request.baseline");
      baseline = { oid: oid(value.baseline.oid, "query request.baseline.oid") };
    }
    const includePaths = paths(
      value.includePaths,
      "query request.includePaths",
    );
    const excludePaths = paths(
      value.excludePaths,
      "query request.excludePaths",
    );
    return {
      schemaVersion: 1,
      workspace,
      query,
      facets,
      maxOutputBytes: value.maxOutputBytes,
      target:
        value.target.kind === "commit"
          ? { kind: "commit", oid: value.target.oid as string }
          : { kind: "working-tree" },
      ...(baseline ? { baseline } : {}),
      ...(includePaths ? { includePaths } : {}),
      ...(excludePaths ? { excludePaths } : {}),
    };
  } catch (error) {
    if (error instanceof ContextPatrolError) throw error;
    throw new ContextPatrolError(
      "REQUEST_INVALID",
      error instanceof Error ? error.message : String(error),
      2,
    );
  }
}
