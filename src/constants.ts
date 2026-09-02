export const PROVIDER_NAME = "contextpatrol";
export const PROVIDER_VERSION = "1.0.0";
export const SCHEMA_VERSION = 1;
export const FACETS = [
  "structure",
  "symbols",
  "relations",
  "source",
  "changes",
  "tests",
] as const;
export const SOURCE_DEPTHS = ["full", "signatures", "listing"] as const;
export const LIMITS = {
  requestBytes: 1024 * 1024,
  maxOutputBytes: 64 * 1024,
  minOutputBytes: 1024,
  maxFiles: 1_000,
  maxFileBytes: 512 * 1024,
  maxPaths: 200,
  maxQueryBytes: 16 * 1024,
  maxSelectedFiles: 120,
  maxSnippets: 24,
  maxSymbols: 120,
  maxRelations: 160,
  maxRankingIdents: 50,
  maxRankingIdentBytes: 128,
} as const;

export const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cs",
  ".css",
  ".go",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mdx",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
