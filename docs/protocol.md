# Context Query: Patrol Protocol 1.0

This is the ContextPatrol-owned contract from the shared Patrol Protocol 1.0.
Packages are independently distributable Node.js 22.13+ tools. There are no sibling
source imports. This is the first public release and the start of its state and
protocol lineage. No prior public version, migration, legacy runtime, or
compatibility mode exists.

Command: `contextpatrol query`. Read one JSON object from stdin and write one JSON
object to stdout. Diagnostics for failures go to stderr; invalid input or provider
failure exits nonzero. Consumers reject any `protocolVersion` other than `1.0`,
validate responses, and bound time and bytes.

```json
{
  "protocolVersion": "1.0",
  "root": "/absolute/repository/path",
  "task": "Repair React form validation",
  "profile": "implementation",
  "paths": ["src/form.tsx"],
  "budget": {"maxFiles": 30, "maxBytes": 24000, "maxDepth": 2}
}
```

`root` and `task` are required. `profile` defaults to `overview`; `paths` defaults
to an empty array; budget values have bounded defaults. Profiles: `overview`,
`architecture`, `implementation`, `review`. Paths are repository-relative seed
files, not permission to escape the root. A query reads the current filesystem
without executing repository code, installing dependencies, or accessing a network.

Response fields:

- `protocolVersion`: `1.0`.
- `profile`: effective profile.
- `snapshot`: SHA-256 identifying bounded input content and analysis semantics.
- `signals`: sorted stack tags such as `typescript`, `react`, `python`, `mcp`.
- `files`: selected objects with `path`, `language`, `score`, `reasons`, and optional `excerpt`.
- `graph`: `nodes` (path strings), `edges` (`from`, `to`, `kind: "imports"`), `cycles` (arrays of paths), `impacted` (path strings).
- `diagnostics`: strings describing unresolved/heuristic analysis and truncation.
- `stats`: `scannedFiles`, `selectedFiles`, `truncated`.
- `digest`: SHA-256 of the recursively key-sorted response without `digest`.

Only local dependency facts are reported, not fabricated call graphs or test
coverage. Graph traversal and complete serialized output are bounded. Selection
is deterministic. Sensitive files and external symlinks are excluded. Omitted
files and heuristic limitations are reported rather than silently called complete.

Hashes are lowercase 64-character SHA-256 hex without a prefix. Canonical JSON is
recursively key-sorted, UTF-8, with no whitespace. Arrays retain their order. The
response digest excludes only the top-level `digest` field and excludes the
transport newline. `maxBytes` includes both the digest field and newline.

ContextPatrol owns read-only snapshots, dependency graphs, impact, and context
budgets. It does not own agents, workflow stages, deployment, or execution gates.
Implementation limits and approximation semantics are in [analysis.md](analysis.md).
