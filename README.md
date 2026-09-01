# ContextPatrol

ContextPatrol is an independent, local-first engine for deterministic, read-only
code context. It examines a Git repository and returns a bounded report of code
structure, symbols, imports, source excerpts, changes, and test signals. It
persists only content-addressed structural facts in the user cache, never in the
analyzed repository. It does not execute analyzed code, use a network, or
require a daemon.

## Commands

```sh
contextpatrol info
contextpatrol query --input request.json
printf '%s' '{"schemaVersion":1,...}' | contextpatrol query --input -
```

`info` describes the provider and its limits. `query` writes exactly one canonical
JSON report to stdout, or one JSON error to stderr.

The persistent cache is an implementation detail. Git and the selected source
snapshot remain authoritative; deleting the user cache only causes a local
re-index on the next query.

## Query Contract

```json
{
  "schemaVersion": 1,
  "workspace": "/absolute/path/to/repository",
  "query": "locate token validation and its callers",
  "facets": ["structure", "symbols", "relations", "source"],
  "maxOutputBytes": 9600,
  "target": { "kind": "working-tree" },
  "includePaths": ["src"]
}
```

Use an immutable commit when current filesystem content is not appropriate:

```json
{
  "schemaVersion": 1,
  "workspace": "/absolute/path/to/repository",
  "query": "summarize authentication impact",
  "facets": ["changes", "symbols", "relations", "tests"],
  "maxOutputBytes": 12800,
  "target": {
    "kind": "commit",
    "oid": "0123456789abcdef0123456789abcdef01234567"
  },
  "baseline": { "oid": "fedcba9876543210fedcba9876543210fedcba98" }
}
```

The public schemas are in `schemas/`. The request has no caller lifecycle fields;
the query describes a code-analysis need, not an orchestration action.

Optional fields keep the contract backward compatible. `sourceDepth` selects how
much source detail excerpts carry when the `source` facet is requested: `full`
(the default when absent) keeps the current excerpt behavior, `signatures` asks
for declaration-level excerpts, and `listing` asks for path-level entries only.

```json
{
  "schemaVersion": 1,
  "workspace": "/absolute/path/to/repository",
  "query": "map the public API surface",
  "facets": ["structure", "symbols", "source"],
  "maxOutputBytes": 16384,
  "target": { "kind": "working-tree" },
  "sourceDepth": "signatures"
}
```

`ranking` supplies deterministic relevance hints that participate in file
scoring: `boostIdents` adds query terms, while `boostPaths` and `dampenPaths`
weight files by path prefix. Every hint list holds at most 50 unique entries of
128 UTF-8 bytes or fewer.

```json
{
  "schemaVersion": 1,
  "workspace": "/absolute/path/to/repository",
  "query": "trace token validation",
  "facets": ["symbols", "relations", "source"],
  "maxOutputBytes": 14400,
  "target": { "kind": "working-tree" },
  "ranking": { "boostIdents": ["validateToken"], "boostPaths": ["src"] }
}
```

Both fields are part of the canonical request, so they are covered by
`requestDigest` and repeatable byte-for-byte. A request that omits them behaves
exactly as before.

## Section Digests

The optional boolean `includeSectionDigests` requests a strict `sectionDigests`
object in the report. It is an additive opt-in capability; omitting it, or
setting it to `false`, preserves the legacy canonical request, `requestDigest`,
and report bytes exactly.

```json
{
  "schemaVersion": 1,
  "workspace": "/absolute/path/to/repository",
  "query": "locate token validation and its callers",
  "facets": ["structure", "symbols", "relations", "source"],
  "maxOutputBytes": 9600,
  "target": { "kind": "working-tree" },
  "includeSectionDigests": true
}
```

When opted in, the report appends a `sectionDigests` object with exactly seven
keys in lexical order, one per report section:

```json
{
  "sectionDigests": {
    "changes": "sha256:...",
    "coverage": "sha256:...",
    "files": "sha256:...",
    "relations": "sha256:...",
    "snippets": "sha256:...",
    "symbols": "sha256:...",
    "tests": "sha256:..."
  }
}
```

Every key is always present when the switch is on. A facet that was not
requested is emitted as its existing empty value, and that empty value is what
is hashed. Digests are computed from the final emitted section values after
budget finalization, so each digest describes exactly the corresponding
consumer-visible section. The `sectionDigests` object participates in the
output budget and in `reportDigest`.

The [section-digest protocol reference](docs/contextpatrol-section-digests.md)
defines the exact preimage, canonical JSON rules, self-reference behavior, and
the limits of what equality proves.

## Integration

The 1.0.0 integration uses process boundaries only. CodePatrol invokes
`contextpatrol query --input -` with an immutable commit target and attaches the
advisory report as `contextSnapshot`. AgentPatrol consumes that snapshot without
reinvoking ContextPatrol. Each project remains independently installable.

## Guarantees

- strict versioned input and canonical JSON output;
- absolute Git-root workspace and exact commit targets only;
- bounded files, file bytes, input bytes, output bytes, snippets, symbols and relations;
- denied metadata, dependency, generated and credential-shaped files;
- redaction before excerpting;
- deterministic UTF-8 ordering and SHA-256 digests;
- Tree-sitter structural facts for C, C#, Go, Java, JavaScript, PHP, Python,
  Ruby, Rust, Swift, and TypeScript;
- exact output-byte budgets rather than model-specific token estimates;
- source-change detection for working-tree analysis.

## Development

```sh
npm install
npm run verify
npm run release-check
```

The [WAVE-5.1 experiment guide](docs/contextpatrol-wave-5-1-experiment.md)
defines controlled evaluation of the stage-typed context profiles.

`spec-survey` and `spec-deep` emphasize structure, `plan-impact` and
`plan-deep` emphasize changes, `build-work` and `build-deep` emphasize
implementation evidence, `review-diff` and `review-grounded` emphasize
comparison evidence, and `readiness` is the ship recipe. These are bounded
advisory recipes. `spec-survey` may set `sourceDepth` to `signatures`.

Any caller may consume reports as optional advisory context. ContextPatrol remains
independent and does not know or invoke its callers.
