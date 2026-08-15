import { z } from "zod";

import {
  ESTIMATOR,
  FOCUS_VALUES,
  LIMITS,
  PROTOCOL_VERSION,
  PROVIDER,
  SCHEMA_VERSION,
} from "./constants.js";

export const focusSchema = z.enum(FOCUS_VALUES);

export const providerDescriptorSchema = z
  .object({
    provider: z.literal(PROVIDER),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    features: z.literal("pack").array(),
    focusValues: focusSchema.array(),
    estimator: z.literal(ESTIMATOR),
    limits: z.object({
      minBudget: z.number().int(),
      maxBudget: z.number().int(),
      maxRequestBytes: z.number().int(),
      maxChangedPaths: z.number().int(),
      maxFileBytes: z.number().int(),
      maxFiles: z.number().int(),
    }),
  })
  .strict();

export const packRequestSchema = z
  .object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    workspace: z.string().min(1),
    intent: z.string().min(1),
    focus: focusSchema.array().min(1).max(FOCUS_VALUES.length),
    tokenBudget: z.number().int().min(LIMITS.minBudget).max(LIMITS.maxBudget),
    changedPaths: z.array(z.string().min(1)).max(LIMITS.maxChangedPaths).optional(),
  })
  .strict();

export const snapshotSchema = z
  .object({
    projectId: z.string(),
    workspaceId: z.string(),
    head: z.string(),
    dirtyDigest: z.string(),
    sourceDigest: z.string(),
    snapshotDigest: z.string(),
    extractorVersion: z.string(),
    policyDigest: z.string(),
  })
  .strict();

export const evidenceSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["architecture", "symbol", "source"]),
    title: z.string(),
    text: z.string(),
    path: z.string().optional(),
    range: z
      .object({
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      })
      .optional(),
    provenance: z.enum(["extracted", "heuristic"]),
    confidence: z.number().min(0).max(1),
    estimatedTokens: z.number().int().nonnegative(),
    clipped: z.boolean().optional(),
  })
  .strict();

export const capsuleSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    capsuleId: z.string(),
    capsuleDigest: z.string(),
    requestDigest: z.string(),
    intent: z.string(),
    focus: focusSchema.array(),
    snapshot: snapshotSchema,
    budget: z
      .object({
        requestedTokens: z.number().int().positive(),
        estimatedTokens: z.number().int().nonnegative(),
        estimator: z.literal(ESTIMATOR),
      })
      .strict(),
    changedPaths: z.array(z.string()),
    evidence: evidenceSchema.array(),
    omitted: z
      .array(
        z
          .object({
            id: z.string(),
            reason: z.enum(["token-budget"]),
          })
          .strict(),
      )
      .optional(),
    warnings: z.array(z.string()),
  })
  .strict();

export const errorSchema = z
  .object({
    error: z.string(),
    message: z.string(),
  })
  .strict();

export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;
export type PackRequest = z.infer<typeof packRequestSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Capsule = z.infer<typeof capsuleSchema>;

export function descriptor(): ProviderDescriptor {
  return {
    provider: PROVIDER,
    protocolVersion: PROTOCOL_VERSION,
    features: ["pack"],
    focusValues: [...FOCUS_VALUES],
    estimator: ESTIMATOR,
    limits: { ...LIMITS },
  };
}
