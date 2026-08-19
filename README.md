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
- estimator: `utf8-bytes/3-conservative-v1`

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
omitted when it has nothing to say: `communities` (deterministic clustering,
cohesion and top files per cluster), `routes` (extracted HTTP routes with
method, path and handler), `deadCode` (exported symbols with no incoming calls,
suppressed entirely when the graph has zero `CALLS` edges), `surprises`
(ranked surprising connections with a deterministic score and reasons) and
`questions` (template-generated review questions referencing real graph node
ids).

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

## Guarantees

- never writes to the analyzed repository;
- never executes analyzed code;
- TypeScript/JavaScript get AST extraction; Markdown and config files are
  documents only;
- hard token budget, deterministic selection and ordering;
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
