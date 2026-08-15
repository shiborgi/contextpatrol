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
- `focus`: `architecture`, `symbols`, `source`
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

## Guarantees

- never writes to the analyzed repository;
- never executes analyzed code;
- TypeScript/JavaScript get AST extraction; Markdown and config files are
  documents only;
- hard token budget, deterministic selection and ordering;
- denylist, redaction, symlink and path-traversal protection;
- detects source change during the operation (`SOURCE_CHANGED`);
- stdout carries only the result; stderr carries only a JSON error.

## Companion

[CodePatrol](https://github.com/shiborgi/codepatrol) is an independent,
optional companion: a local-first workflow and state orchestrator for coding
agents. ContextPatrol complements it by producing the bounded context a harness
uses during the Spec and Plan phases. There is no coupling — CodePatrol only
detects ContextPatrol on `PATH` via `doctor`; ContextPatrol never depends on
CodePatrol.

## License

MIT
