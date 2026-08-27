import type { FACETS, SOURCE_DEPTHS } from "./constants.js";

export interface CachedFacts {
  language: string;
  symbols: Array<{
    id: string;
    path: string;
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
    exported: boolean;
  }>;
  imports: string[];
  terms: string[];
}

export type Facet = (typeof FACETS)[number];
export type SourceDepth = (typeof SOURCE_DEPTHS)[number];

export interface RankingHints {
  boostIdents?: string[];
  boostPaths?: string[];
  dampenPaths?: string[];
}

export interface QueryRequest {
  schemaVersion: 1;
  workspace: string;
  query: string;
  facets: Facet[];
  maxOutputBytes: number;
  target: { kind: "working-tree" } | { kind: "commit"; oid: string };
  baseline?: { oid: string };
  includePaths?: string[];
  excludePaths?: string[];
  sourceDepth?: SourceDepth;
  ranking?: RankingHints;
}

export interface SourceFile {
  path: string;
  content: string;
  hash: string;
  language: string;
  lines: number;
}

export interface ContextReport {
  schemaVersion: 1;
  provider: { name: "contextpatrol"; version: "1.0.0" };
  requestDigest: string;
  reportDigest: string;
  target: {
    kind: "working-tree" | "commit";
    commit: string;
    dirtyDigest: string;
    contentDigest: string;
  };
  budget: {
    maxOutputBytes: number;
    outputBytes: number;
    limited: boolean;
  };
  summary: {
    query: string;
    filesConsidered: number;
    filesSelected: number;
  };
  files: Array<{
    path: string;
    score: number;
    language: string;
    lines: number;
  }>;
  symbols: Array<{
    id: string;
    path: string;
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
    exported: boolean;
  }>;
  relations: Array<{
    kind: "imports";
    from: string;
    to: string;
  }>;
  changes: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
  }>;
  tests: {
    files: string[];
    changedSourceWithoutTest: string[];
  };
  snippets: Array<{
    path: string;
    startLine: number;
    endLine: number;
    text: string;
    clipped: boolean;
  }>;
  coverage: {
    eligibleFiles: number;
    analyzedFiles: number;
    skippedBinary: number;
    skippedOversized: number;
    omittedFiles: number;
    omittedSymbols: number;
    omittedRelations: number;
    omittedSnippets: number;
    unresolvedRelations: number;
  };
}
