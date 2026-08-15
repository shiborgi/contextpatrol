# Architecture

ContextPatrol is a single small pipeline with no persistent state and no
daemon. One request maps to one capsule.

```
request JSON (strict)
  -> workspace resolution (Git root, HEAD, identity)
  -> file discovery (tracked + untracked non-ignored, minus denylist)
  -> safe bounded read
  -> TS/JS AST extraction (symbol facts)
  -> in-memory snapshot (identity + file manifest + dirty digest)
  -> candidate generation (architecture / symbols / source)
  -> ranking by intent + focus + changedPaths
  -> hard-budget packing (source is clipable, the rest is atomic)
  -> re-verify source unchanged
  -> capsule (digests, evidence, warnings)
```

## Identity and digests

- `projectId = SHA-256(realpath(git-common-dir))`
- `workspaceId = SHA-256(realpath(worktree-root))`
- `head` is the full resolved OID.
- `dirtyDigest` hashes the eligible dirty entries (`path + content hash`).
- `sourceDigest` hashes `head + dirtyDigest + file manifest`.
- `snapshotDigest` hashes `sourceDigest + extractor + policy`.
- `requestDigest` hashes the normalized request.
- `capsuleDigest` hashes the capsule body (everything except the digest field).

All digests are `SHA-256` over canonical JSON (sorted keys, no whitespace).

## Determinism

The same request against the same source state always produces the same
capsule. No timestamps or non-deterministic ordering participate in any
digest.

## Budget

The estimator is byte-conservative (`ceil(bytes / 3)`) and versioned as
`utf8-bytes/3-conservative-v1`. Only `source` evidence is truncated; other
evidence is either fully included or omitted with reason `token-budget`.

## Source-change detection

Before emitting the capsule, the dirty entry set is re-read from Git and
compared with the set observed at discovery. Any difference fails the
operation with `SOURCE_CHANGED`; retries are the caller's responsibility.
