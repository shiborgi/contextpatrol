# Changelog

## 1.0.0

- Exclude MemoryPatrol databases from repository context at every directory depth.

Initial public release implementing Patrol Protocol 1.0 Context Query.

- Expose `query` and a closed request with `root`, `task`, `profile`, `paths`, and `budget`.
- Read bounded filesystem snapshots in ordinary directories and Git working trees without invoking Git.
- Extract real JS/TS/Python syntax imports; report heuristic local edges, bounded reverse impact and cycle representatives.
- Detect stack hints, vary profile ranking/detail, and preserve deterministic selection and canonical SHA-256 digests.
- Bound the entire response including digest/newline, with explicit truncation diagnostics.
- Exclude sensitive paths, all in-root symlinks, binary and oversized files; redact credential-shaped content.
- Provide portable Patrol Protocol 1.0 provider argv with no executor or remote authority.
- Add strict validation, security, graph, CLI, determinism and offline installed-package tests on Node.js 22.13+.

There is no prior public version, migration path, legacy runtime, or compatibility mode.
