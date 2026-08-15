# Changelog

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
