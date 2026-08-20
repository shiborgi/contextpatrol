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
    optionalRequestFields: z.string().array(),
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
    gitRef: z.string().min(1).optional(),
    baseRef: z.string().min(1).optional(),
    includePaths: z.array(z.string().min(1)).max(LIMITS.maxChangedPaths).optional(),
    excludePaths: z.array(z.string().min(1)).max(LIMITS.maxChangedPaths).optional(),
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

export const riskFactorSchema = z
  .object({
    factor: z.string(),
    raw: z.number(),
    capped: z.number(),
    contribution: z.number(),
  })
  .strict();

export const symbolRiskSchema = z
  .object({
    qualifiedName: z.string(),
    totalRisk: z.number(),
    factors: riskFactorSchema.array(),
  })
  .strict();

export const graphSectionSchema = z
  .object({
    fileCount: z.number().int().nonnegative(),
    symbolCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    godSymbols: z.array(
      z.object({ qualifiedName: z.string(), score: z.number() }).strict(),
    ),
    boundaryFiles: z.array(z.string()),
    communities: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string().min(1),
            memberCount: z.number().int().nonnegative(),
            topFiles: z.array(z.string()),
            cohesion: z.number(),
          })
          .strict(),
      )
      .optional(),
    routes: z
      .array(
        z
          .object({
            id: z.string(),
            method: z.string(),
            path: z.string(),
            handler: z.string().nullable(),
          })
          .strict(),
      )
      .optional(),
    deadCode: z
      .array(
        z
          .object({
            qualifiedName: z.string(),
            confidence: z.number(),
          })
          .strict(),
      )
      .optional(),
    surprises: z
      .array(
        z
          .object({
            from: z.string(),
            to: z.string(),
            score: z.number(),
            reasons: z.array(z.string()),
          })
          .strict(),
      )
      .optional(),
    questions: z
      .array(
        z
          .object({
            text: z.string(),
            nodeId: z.string(),
          })
          .strict(),
      )
      .optional(),
    outlines: z
      .array(
        z
          .object({
            path: z.string(),
            symbols: z.array(
              z
                .object({
                  qualifiedName: z.string(),
                  kind: z.string(),
                  exported: z.boolean(),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .optional(),
    referenceCensus: z
      .array(
        z
          .object({
            qualifiedName: z.string(),
            incomingCalls: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .optional(),
    layers: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            nodeIds: z.array(z.string()),
          })
          .strict(),
      )
      .optional(),
    tour: z
      .array(
        z
          .object({
            order: z.number().int().positive(),
            nodeId: z.string(),
          })
          .strict(),
      )
      .optional(),
    dirImports: z
      .array(
        z
          .object({
            from: z.string(),
            to: z.string(),
            count: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const reviewSectionSchema = z
  .object({
    changedSymbols: z.array(z.string()),
    risk: symbolRiskSchema.array(),
    impact: z
      .object({
        direct: z.array(z.object({ id: z.string(), score: z.number() }).strict()),
        transitive: z.array(z.object({ id: z.string(), score: z.number() }).strict()),
      })
      .strict(),
    testGaps: z.array(z.string()),
  })
  .strict();

export const coverageSectionSchema = z
  .object({
    unresolvedCalls: z.array(
      z
        .object({
          callerQualifiedName: z.string(),
          count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    skipped: z.array(z.object({ path: z.string(), reason: z.string() }).strict()),
    truncated: z.boolean(),
    languagesSeen: z.array(z.string()),
    historyWindow: z.number().int().nonnegative(),
    graphIntegrity: z
      .object({
        missingSources: z.number().int().nonnegative(),
        missingTargets: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const sectionsSchema = z
  .object({
    graph: graphSectionSchema.optional(),
    review: reviewSectionSchema.optional(),
    coverage: coverageSectionSchema,
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
    includePaths: z.array(z.string().min(1)).max(LIMITS.maxChangedPaths).optional(),
    excludePaths: z.array(z.string().min(1)).max(LIMITS.maxChangedPaths).optional(),
    evidence: evidenceSchema.array(),
    sections: sectionsSchema,
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
export type Sections = z.infer<typeof sectionsSchema>;

export function descriptor(): ProviderDescriptor {
  return {
    provider: PROVIDER,
    protocolVersion: PROTOCOL_VERSION,
    features: ["pack"],
    focusValues: [...FOCUS_VALUES],
    estimator: ESTIMATOR,
    limits: { ...LIMITS },
    optionalRequestFields: [
      "changedPaths",
      "gitRef",
      "baseRef",
      "includePaths",
      "excludePaths",
    ],
  };
}
