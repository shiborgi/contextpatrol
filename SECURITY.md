# Security

ContextPatrol reads source and returns small, bounded evidence. Its trust
boundaries are absolute:

1. **It never writes to the analyzed repository.** There is no persistent
   cache, no lock file, and no snapshot written into the worktree. Every
   operation is read-only.
2. **It never executes analyzed code.** Parsing is limited to the TypeScript
   compiler API for TS/JS files; nothing else is evaluated or required.
3. **It never follows symlinks.** Reads use `O_NOFOLLOW` and re-verify the
   inode, so a swapped intermediate symlink cannot leak content outside the
   workspace.
4. **It neutralizes the Git environment.** System and global Git config are
   disabled and inherited `GIT_*`/`git_*` variables are stripped.

## Defense in depth

- **Denylist**: secret-shaped paths (`.env`, `*.pem`, `*.key`, `id_rsa`,
  `credentials`, `.npmrc`, ...) and generated trees (`node_modules`, `dist`,
  caches) never enter the index, the dirty digest, or any capsule.
- **Redaction**: common secret shapes (private key blocks, bearer tokens,
  JWTs, AWS access keys, `key=value` assignments) are replaced before any
  text is emitted or truncated.
- **Bounded reads**: files are limited to 1 MB, requests to 1 MiB, and files
  to 10 000 per run.

Redaction is defense in depth, not a proof of absence. The primary
protections are the denylist, bounded snippets, and the fact that whole files
are never persisted.
