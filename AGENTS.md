# Repository Guidance

- ContextPatrol owns only neutral code-analysis queries and reports.
- Do not add lifecycle terms, caller IDs, orchestrator state, agent identities, or deployment authority to its public protocol.
- Keep all analysis read-only, deterministic, bounded, and free of network access.
- Use CodePatrol for substantive changes when it is configured for this repository.

## Gates

- Quality: `npm run verify`
- Release: `npm run release-check`

Keep documentation, code comments, contracts, and generated GitHub artifacts in English.
