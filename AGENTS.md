# Repository Guidance

- ContextPatrol owns only neutral code-analysis queries and reports.
- Do not add lifecycle terms, caller IDs, orchestrator state, agent identities, or deployment authority to its public protocol.
- Keep all analysis read-only, deterministic, bounded, and free of network access.
- This repository implements only Patrol Protocol 1.0; do not add compatibility modes.
- This is the first public release; there is no prior migration path or legacy runtime.
- Do not run CodePatrol automatically. The portable 1.0 config has no executor or remote authority.
- Keep changes inside this repository; AgentPatrol, CodePatrol, MemoryPatrol, and
  ModelPatrol are independently owned.
- Use syntax evidence for imports and honest diagnostics for approximations, never invented coverage.
- Measure the complete canonical response including digest and newline against maxBytes.

## Gates

- Quality: `npm run verify`
- Release: `npm run release-check`

Keep documentation, code comments, contracts, and generated GitHub artifacts in English.
