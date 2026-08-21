# ContextPatrol

Local-first, read-only, commit-aware context capsules for coding agents.

ContextPatrol receives a strict JSON request with an `intent`, a set of
`focus` values, and a `tokenBudget`, and returns the smallest deterministic,
verifiable context that is still useful — without a daemon, without
embeddings, without the cloud, and without ever writing to the analyzed
repository.

## Commands

```
contextpatrol protocol
contextpatrol pack --request FILE|-
contextpatrol --help
contextpatrol --version
```

## Quick start

```bash
npm ci
npm run verify

# Handshake:
contextpatrol protocol

# Build a capsule from a strict request:
contextpatrol pack --request request.json
printf '%s' '{"protocolVersion":1,...}' | contextpatrol pack --request -
```

## Protocol v1

The only protocol version is `1`. Strict parsers reject unknown fields,
lifecycle vocabulary (`stage`, `operation`, `runId`), and any other protocol
version — no fallback, no heuristics.

- `protocolVersion`: `1`
- `focus`: `architecture`, `symbols`, `source`, `graph`, `review`
- estimator: `cl100k_base@1.0.0`

Contract schemas and fixtures live in `protocol/`.

## Request

```json
{
  "protocolVersion": 1,
  "workspace": "/repo",
  "intent": "locate the authentication contracts",
  "focus": ["architecture", "symbols", "source"],
  "tokenBudget": 2400,
  "changedPaths": ["src/auth.ts"]
}
```

`workspace` is the only way to select the repository. The current worktree is
analyzed: full `HEAD`, a `dirtyDigest`, and deterministic facts.

### Graph and review focus

Ask for `graph` to receive `sections.graph` (file/symbol/edge counts, god
symbols, boundary files) and `review` to receive `sections.review` (changed
symbols, per-symbol risk with factors, impact by depth, test gaps). A
`coverage` section (unresolved call census, skips, languages, history window)
is always present.

Beyond the counts, `sections.graph` carries optional insight fields, each
omitted when it has nothing to say: `outlines` (capped file/symbol overview,
no source bodies), `referenceCensus` (symbols ranked by incoming `CALLS` count),
`communities` (deterministic clustering, cohesion and top files per cluster),
`routes` (extracted HTTP routes with method, path and handler), `deadCode`
(exported symbols with no incoming calls, suppressed entirely when the graph
has zero `CALLS` edges), `surprises` (ranked surprising connections with a
deterministic score and reasons) and `questions` (template-generated review
questions referencing real graph node ids).

These optional graph fields are dropped in priority order under tight token
budgets (outlines and referenceCensus first). `layers` groups files by stable
path patterns, `tour` gives a bounded breadth-first read order from the highest
scoring entry point, and `dirImports` summarizes cross-directory flow. The
coverage section also reports graph integrity counts and excludes test callers
from unresolved-call census noise.

```json
{
  "protocolVersion": 1,
  "workspace": "/repo",
  "intent": "what changed in authentication",
  "focus": ["graph", "review"],
  "tokenBudget": 2400,
  "changedPaths": ["src/auth.ts"]
}
```

## Recipes (caller-side)

CodePatrol profiles (or other callers) may use these high-level recipes when deciding how to populate a pack request. The recipes are naming conventions only — they are not fields in the pack protocol.

- **map**: `architecture` + `graph` — broad structural view of the codebase.
- **hotspot**: `graph` + `includePaths` — focus analysis on specific subtrees.
- **impact**: `graph` + `review` using a worktree workspace and `baseRef` — review delta between a base and the target.

Example using the current worktree (default behaviour):

```json
{
  "protocolVersion": 1,
  "workspace": "/repo",
  "intent": "map the authentication module",
  "focus": ["architecture", "graph"],
  "tokenBudget": 2000
}
```

Example using `gitRef` + `baseRef` for impact review:

```json
{
  "protocolVersion": 1,
  "workspace": "/repo",
  "intent": "review impact of changes",
  "focus": ["graph", "review"],
  "tokenBudget": 2000,
  "gitRef": "feature/xyz",
  "baseRef": "main"
}
```

The pack request protocol strictly rejects `stage`, `operation`, and `runId` (lifecycle vocabulary belongs to the caller/profile, not the pack).

## Project overlay

A `contextpatrol.project.json` file (read-only) may exist at the git root of
the analyzed repository. It is never written by `pack`.

```json
{
  "includePaths": ["src/"],
  "excludePaths": ["src/generated/"]
}
```

- Supplies default `includePaths` / `excludePaths` when the request omits them.
- Request values always win on conflict.
- Missing file is a silent no-op.
- Malformed JSON, unknown keys, or invalid paths → `REQUEST_INVALID`.

`pack` never writes to the analyzed repository.

Every capsule carries an `analysisTarget` manifest that pins the resolved
commit, scope, source and policy digests, configuration and overlay inputs,
history endpoint, truncation state, and a final `manifestDigest`. Historical
`gitRef` requests read overlays and source metadata from Git objects rather than
the current filesystem.

ContextPatrol has no integration with Understand-Anything. It remains a
local-first pack provider: callers may use its capsules as context, but the
pack command neither invokes external understanding services nor writes their
state into the analyzed repository.

## Guarantees

- never writes to the analyzed repository;
- never executes analyzed code;
- TypeScript/JavaScript get AST extraction; Markdown and config files are
  documents only;
- hard token budget over the complete canonical response envelope; requests
  that cannot fit return deterministic `BUDGET_TOO_SMALL` errors;
- denylist, redaction, symlink and path-traversal protection;
- detects source change during the operation (`SOURCE_CHANGED`);
- stdout carries only the result; stderr carries only a JSON error.

### Exit codes

- `0` — success.
- `2` — request or usage validation: `REQUEST_INVALID`, `USAGE`,
  `REQUEST_READ_FAILED`, `REQUEST_TOO_LARGE`.
- `1` — runtime: `WORKSPACE_INVALID`, `SOURCE_CHANGED`, `INTERNAL`.

## Companion

[CodePatrol](https://github.com/shiborgi/codepatrol) is an independent,
optional companion: a local-first workflow and state orchestrator for coding
agents. ContextPatrol complements it by producing the bounded context a harness
uses during the Spec and Plan phases. There is no coupling — CodePatrol only
detects ContextPatrol on `PATH` via `doctor`; ContextPatrol never depends on
CodePatrol.

## License

MIT
