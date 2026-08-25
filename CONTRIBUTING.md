# Contributing

ContextPatrol is TypeScript for Node.js 22. Install with `npm ci`.

```bash
npm run verify
npm run release-check
```

`verify` runs type checking, Biome, unit tests, a local smoke query, and CLI
loading. `release-check` packs and installs the npm artifact, then smokes the
installed binary.

Changes must preserve read-only, deterministic, bounded analysis with no
network access. Do not add lifecycle terms, caller IDs, orchestrator state,
agent identities, or deployment authority to the public protocol. Do not add a
package dependency on codepatrol or agentpatrol.
