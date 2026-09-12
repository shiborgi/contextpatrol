import path from "node:path";

export const PROTOCOL_VERSION = "1.0" as const;
export const VERSION = "1.0.0";
export const PROFILES = [
  "overview",
  "architecture",
  "implementation",
  "review",
] as const;
export type Profile = (typeof PROFILES)[number];
export interface Budget {
  maxFiles: number;
  maxBytes: number;
  maxDepth: number;
}
export interface QueryRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  root: string;
  task: string;
  profile?: Profile;
  paths?: string[];
  budget?: Partial<Budget>;
}
export interface EffectiveQuery extends QueryRequest {
  profile: Profile;
  paths: string[];
  budget: Budget;
}
export interface SelectedFile {
  path: string;
  language: string;
  score: number;
  reasons: string[];
  excerpt?: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: "imports";
}

export interface Graph {
  nodes: string[];
  edges: GraphEdge[];
  cycles: string[][];
  impacted: string[];
}
export interface QueryResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  profile: Profile;
  snapshot: string;
  signals: string[];
  files: SelectedFile[];
  graph: Graph;
  diagnostics: string[];
  stats: { scannedFiles: number; selectedFiles: number; truncated: boolean };
  digest: string;
}
export const DEFAULT_BUDGET: Readonly<Budget> = Object.freeze({
  maxFiles: 30,
  maxBytes: 24000,
  maxDepth: 2,
});
export const LIMITS = Object.freeze({
  maxFiles: 2000,
  maxFileBytes: 262144,
  maxSourceBytes: 16777216,
  maxEntries: 20000,
  directoryDepth: 32,
  maxImports: 256,
  maxDiagnostics: 100,
  maxInputBytes: 65536,
});

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function closed(value: Record<string, unknown>, keys: string[], name: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`${name} contains unknown fields`);
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters at the path boundary.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;
export function safePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !/[\\:*?[\]{}]/.test(value) &&
    !CONTROL_CHARACTERS.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}
export function parseQuery(value: unknown): EffectiveQuery {
  const input = object(value, "query");
  closed(
    input,
    ["protocolVersion", "root", "task", "profile", "paths", "budget"],
    "query",
  );
  if (input.protocolVersion !== PROTOCOL_VERSION)
    throw new Error(`protocolVersion must be "${PROTOCOL_VERSION}"`);
  if (
    typeof input.root !== "string" ||
    !path.isAbsolute(input.root) ||
    input.root.length > 4096 ||
    CONTROL_CHARACTERS.test(input.root)
  )
    throw new Error("root must be an absolute directory path");
  if (typeof input.task !== "string" || !input.task.trim() || input.task.length > 8192)
    throw new Error("task must be nonempty text of at most 8192 characters");
  const profile = input.profile === undefined ? "overview" : input.profile;
  if (!PROFILES.includes(profile as Profile))
    throw new Error(
      "profile must be overview, architecture, implementation, or review",
    );
  const paths = input.paths === undefined ? [] : input.paths;
  if (!Array.isArray(paths) || paths.length > 100 || !paths.every(safePath))
    throw new Error(
      "paths must contain at most 100 repository-relative seed file paths (no traversal or globs)",
    );
  const budget = { ...DEFAULT_BUDGET };
  if (input.budget !== undefined) {
    const supplied = object(input.budget, "budget");
    closed(supplied, ["maxFiles", "maxBytes", "maxDepth"], "budget");
    for (const [key, min, max] of [
      ["maxFiles", 1, 500],
      ["maxBytes", 1024, 1048576],
      ["maxDepth", 0, 20],
    ] as const) {
      if (supplied[key] === undefined) continue;
      const number = supplied[key];
      if (
        typeof number !== "number" ||
        !Number.isInteger(number) ||
        number < min ||
        number > max
      )
        throw new Error(`budget.${key} must be an integer from ${min} to ${max}`);
      budget[key] = number;
    }
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    root: input.root,
    task: input.task,
    profile: profile as Profile,
    paths: [...new Set(paths)].sort(),
    budget,
  };
}
