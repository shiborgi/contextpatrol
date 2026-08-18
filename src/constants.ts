export const PROVIDER = "contextpatrol" as const;
export const PROTOCOL_VERSION = 1 as const;
export const SCHEMA_VERSION = 1 as const;
export const ESTIMATOR = "utf8-bytes/3-conservative-v1" as const;
export const EXTRACTOR_VERSION = "typescript-ast-v2" as const;
export const POLICY_VERSION = 1 as const;

export const FOCUS_VALUES = ["architecture", "symbols", "source"] as const;
export type Focus = (typeof FOCUS_VALUES)[number];

export const LIMITS = {
  minBudget: 256,
  maxBudget: 32_000,
  maxRequestBytes: 1_048_576,
  maxChangedPaths: 200,
  maxFileBytes: 1_000_000,
  maxFiles: 10_000,
} as const;

export const DEFAULT_DENYLIST = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa",
  "id_rsa.*",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "credentials",
  "credential",
  ".npmrc",
  ".netrc",
  "secrets",
  "secret",
  "*.secret",
  "node_modules",
  ".patrol",
  ".git",
  "coverage",
  "dist",
  "build",
  ".DS_Store",
] as const;
