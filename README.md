# ContextPatrol

Deterministic, bounded, read-only repository context for Node.js 22.13+. ContextPatrol
reads the current filesystem, extracts local imports, ranks task-relevant files,
and returns one budgeted Patrol Protocol **1.0** response. It does not run agents,
execute repository code, install dependencies, invoke Git, or access the network.

This is the first public release. There is no prior public version, migration path,
legacy runtime, compatibility command, facet protocol, or persisted state.

## CLI

Install the initial release with
`npm install -g 'git+ssh://git@github.com/shiborgi/contextpatrol.git#<commit-sha>'`.
From a checkout, use `npm ci` and
`npm run build`, then `node bin/contextpatrol.js` in place of `contextpatrol`.

```bash
printf '%s\n' '{"protocolVersion":"1.0","root":"/absolute/repo","task":"Repair React form validation","profile":"implementation","paths":["src/form.tsx"],"budget":{"maxFiles":30,"maxBytes":24000,"maxDepth":2}}' | contextpatrol query
contextpatrol query --input request.json
contextpatrol query --input -
contextpatrol info
contextpatrol --help
contextpatrol --version
```

`query` reads one UTF-8 JSON object from stdin by default. Input is limited to
65,536 bytes. Successful stdout is exactly one compact recursively key-sorted JSON
object plus a newline. Errors go to stderr with exit code 1 and empty stdout.
`info` returns `name`, `version`, `protocolVersion`, and `profiles` as JSON.
`help`/`-h` and `version` are aliases for `--help` and `--version`.

## Library

```ts
import { query, canonicalJson, digest, type QueryRequest } from "contextpatrol";

const request: QueryRequest = {
  protocolVersion: "1.0",
  root: "/absolute/repo",
  task: "Repair React form validation",
  profile: "implementation",
  paths: ["src/form.tsx"],
  budget: { maxFiles: 30, maxBytes: 24000, maxDepth: 2 },
};
const response = await query(request);
const { digest: expected, ...payload } = response;
if (digest(payload) !== expected) throw new Error("Digest mismatch");
process.stdout.write(canonicalJson(response) + "\n");
```

`query(input: unknown): Promise<QueryResponse>` validates untrusted input and
rejects invalid requests or inaccessible roots. `parseQuery(input: unknown)`
returns an `EffectiveQuery` with normalized paths and defaults, without reading
the repository. `canonicalJson(value: unknown): string` accepts JSON values;
`digest(value: unknown): string` hashes their canonical JSON as lowercase SHA-256.
Exported constants: `VERSION`, `PROTOCOL_VERSION`, `PROFILES`, `DEFAULT_BUDGET`.
Exported types: `QueryRequest`, `EffectiveQuery`, `QueryResponse`, `Budget`,
`Profile`, `Graph`, `SelectedFile`. The package is ESM, with TypeScript declarations.

## Query Contract

Required fields are exactly `protocolVersion: "1.0"`, absolute `root`, and nonempty
`task`. Optional fields are `profile`, `paths`, and `budget`. Unknown fields and
all other protocol versions are rejected. Paths are relative **seed files, not filters or globs**;
missing/excluded seeds produce diagnostics. Symlinks cannot grant access outside
the root. Ordinary directories and Git working trees are both supported.

| Budget | Default | Accepted Range |
| --- | --- | --- |
| `maxFiles` | 30 | 1-500 |
| `maxBytes` | 24000 | 1024-1048576 |
| `maxDepth` | 2 | 0-20 |

The byte budget covers the **entire canonical response, including digest and
trailing newline**. Other serializers or pretty printing can exceed it. Under a
small budget the result may contain no selected files. `maxDepth` bounds reverse
impact hops and cycle traversal, not filesystem depth or seed permissions.

The response always includes `protocolVersion`, `profile`, `snapshot`, `signals`,
`files`, `graph`, `diagnostics`, `stats`, and `digest`. Files have `path`, `language`,
`score`, `reasons`, and optionally `excerpt`. Graph nodes are path strings, edges
are `{from,to,kind:"imports"}`, cycles are closed path arrays, and `impacted` lists
reverse-transitive importers excluding seeds. The output graph is restricted to
selected files. `stats` contains `scannedFiles`, `selectedFiles`, and `truncated`.

| Profile | Selection and Detail |
| --- | --- |
| `overview` (default) | Metadata and documentation; no excerpts |
| `architecture` | Entry-point paths and import centrality; up to 320 excerpt characters |
| `implementation` | Source files, task matches and dependencies; up to 2400 characters |
| `review` | Reverse impact and test-path hints; up to 1200 characters, never invented coverage |

All profiles use lexical task ranking, graph evidence, strong seed preference, and
deterministic path tie-breaking. Signals such as `typescript`, `tsx`, `react`,
`python`, `nextjs`, `mcp`, and `fastapi` are stack hints, not verified runtime facts.

See [Context Query protocol](docs/protocol.md), [analysis details](docs/analysis.md),
[request schema](schemas/query-request.schema.json),
[response schema](schemas/query-response.schema.json), and [security](SECURITY.md).

## Local Verification

```bash
npm run verify
npm run release-check
```

`verify` type-checks strict TypeScript, lints, builds, tests, and runs local library
and CLI smokes. `release-check` packs and installs in a temporary directory with
`--ignore-scripts`, then exercises the installed library, CLI, and Python WASM
parser. Its artifact installation uses the npm registry for dependencies. Neither
command publishes or contacts GitHub.

`codepatrol.json` contains only portable Patrol Protocol 1.0 provider argv, explicit local
verification, bounded limits, and disabled telemetry. There is no configured
executor or remote authority. ContextPatrol never reads or runs this config.
