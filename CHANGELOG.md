# Changelog

## Unreleased

- Extraction v2: import, call and rationale facts; `isTest` heuristic.
- Code graph with confidence tiers: `CONTAINS`, `IMPORTS`, `INHERITS`,
  `IMPLEMENTS`, `CALLS` (same-file 0.95 / import-scoped 0.90), `TESTED_BY`
  inference; zero-edge guarantee for unresolved call targets.
- Git history mining (churn and co-change) and diff-to-symbol mapping.
- Analysis: noise-filtered centrality, bounded decaying blast radius, capped
  additive risk rubric, RRF ranking with identifier-shape boosting.
- Capsule sections: `graph`, `review` and `coverage`; focus values extended
  with `graph` and `review`.
- `EXTRACTOR_VERSION` bumped to `typescript-ast-v2`.
- Deterministic graph insight layer: communities (connected components +
  weakest-edge prune), HTTP route facts (Express/Fastify + decorators), dead
  code with epistemic honesty, surprising connections (scored) and
  template-generated suggested questions — all as optional `sections.graph`
  fields, omitted when empty.
- Graph honesty and budget truth: NodeNext `.js` import resolution onto
  TypeScript sources; `estimatedTokens` counts emitted sections; `source:`
  evidence ids; bin-to-source entry reachability; god-symbol noise filter
  (exported or cross-file-called); external-library census skip; shims/scripts
  excluded from test gaps; community question cites its hub; richer
  architecture evidence and documented exit codes.
- INIT-4 precision and visibility: dead-code skips type-level symbols
  (`interface`, `type`, `enum`); unresolved-call census skips multiline
  external callees; `godSymbols` capped at 20 (score-desc then bytewise) and
  `unresolvedCalls` capped at 50 (count-desc then bytewise); communities with
  more than 20 members and cohesion below 0.1 are split.

## 1.0.0

First release of the reconstructed ContextPatrol. Requires Node.js 22 or newer.

- Protocol version `1` with strict parsers and no backward compatibility with
  any prior prototype.
- Commands: `protocol` and `pack`; JSON-only output; JSON errors on stderr.
- Worktree-only analysis: full `HEAD`, `dirtyDigest`, `sourceDigest`,
  `snapshotDigest`.
- TypeScript/JavaScript AST extraction; Markdown and config files as documents.
- Focus values: `architecture`, `symbols`, `source`.
- Hard token budget with byte-conservative estimator and deterministic packing.
- Denylist, redaction, symlink/traversal protection, bounded reads, and
  neutralized Git environment.
- Source-change detection during the operation.
- Published JSON Schemas under `protocol/` with a fixture-consistency gate.
- Independent optional companion: complements CodePatrol (context for the Spec
  and Plan phases); no coupling in either direction.
