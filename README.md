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
defines controlled evaluation of the opt-in context profiles.

Any caller may consume reports as optional advisory context. ContextPatrol remains
independent and does not know or invoke its callers.
