# Security

ContextPatrol reads source only. The runtime does not execute repository code,
spawn Git or shell commands, write to the analyzed root, access a network, install
dependencies, or read environment credentials. No repository config grants extra
permissions. The separate development/release gates execute trusted local tooling;
release-check installs a packed artifact normally with lifecycle scripts disabled
and requires npm registry access.

Seeds must be relative file paths with no traversal, control characters, Windows
drive/UNC syntax, backslashes, or globs. Root must be absolute and accessible. The
root itself is canonicalized; this deliberately allows a caller-selected root
symlink, but all symlinks *inside* it (including internal links) are excluded.
Path components are checked, real paths must remain contained, and leaf files use
`O_NOFOLLOW` and `O_NONBLOCK`. Nonregular files, invalid UTF-8, binary control data,
oversized files and excessive traversal are excluded. Reads check file identity
and size and reject detected concurrent changes.

Denied paths include `.env` variants, credential/secret/password/token/api-key
names, private-key and certificate-store extensions, SSH key names, `.npmrc`,
`.netrc`, `.pypirc`, and directories such as `keys`, `secrets`, `credentials`,
`.ssh`, `.aws`, `.azure`, `.kube`, `.gnupg`, `.git`, `.codepatrol`, `node_modules`,
`vendor`, generated output and virtual environments. Exclusions are case-insensitive
and apply at every directory level. `.codepatrol` state and retained worktrees are
tooling metadata: their contents are neither traversed nor included in snapshots.
Credential-shaped source strings and key blocks are redacted before extraction,
ranking and excerpts. Raw accepted content contributes only a SHA-256 to the
snapshot. Redaction is best-effort, not a secret scanner or confidentiality proof.
Avoid querying repositories with secrets in ordinary source or filenames. Hashes
are not encryption and can enable guessing of low-entropy content.

Node's portable filesystem API does not provide an atomic openat-style walk.
Component checks and no-follow opens defend against static path/symlink attacks,
but are not a sandbox against an adversary concurrently replacing ancestor
directories. Use an immutable, permission-isolated copy for hostile repositories
or concurrent adversarial writers. Reads are bounded, but an unresponsive remote
filesystem can still block; consumers must enforce a process timeout. Stdin is
byte-bounded but waits for EOF; callers must also bound invocation time.

Reports may contain source, task-matching terms and repository-relative names.
Handle them as sensitive local data. There is no telemetry or automatic export.
Analysis is heuristic and advisory, never authorization, call-graph proof or test
coverage. See [analysis limits](docs/analysis.md). Report suspected vulnerabilities
privately to the repository maintainers; do not attach credentials or private code
to public reports. Only Patrol Protocol 1.0 is supported; no compatibility mode exists.
