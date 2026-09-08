# Contributing

ContextPatrol is strict TypeScript for Node.js 22.13+. Install with `npm ci`.

```bash
npm run verify
npm run release-check
```

`verify` runs type checking, Biome, unit tests, a local smoke query, and CLI
loading. `release-check` packs and installs the npm artifact, then smokes the
installed binary and library, including the packaged Python WASM grammar. Packing
and installation disable lifecycle scripts; installation uses the npm registry for
dependencies. No gate publishes, pushes, contacts GitHub, or runs CodePatrol. The
checked-in portable Patrol Protocol 1.0 config has no executor.

Changes must preserve read-only, deterministic, bounded analysis with no
network access. Do not add lifecycle terms, caller IDs, orchestrator state,
agent identities, or deployment authority to the public protocol. Do not add a
package dependency on codepatrol or agentpatrol.

Only Patrol Protocol 1.0 contracts are exported. Keep schemas, protocol documentation
and tests in sync. This first public release has no migration, legacy, compatibility,
cache, or parallel runtime. Keep modules focused
on contracts, source safety, language extraction, graph, selection/budget, query,
and CLI. Test deterministic hashes and full serialized byte bounds (digest and
newline included), malformed requests, path/symlink/secret attacks, real imports,
reverse impact, cycles, stack hints, profile behavior and installed artifacts.
Use local temporary fixtures; never execute analyzed repository dependencies.
