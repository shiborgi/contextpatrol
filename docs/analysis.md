# Analysis Semantics

## Pipeline

`contracts.ts` validates a closed Patrol Protocol 1.0 request. `source.ts` takes a bounded read-only
filesystem snapshot. `language.ts` extracts syntax facts and stack hints.
`graph.ts` resolves only observed local files and computes bounded graph evidence.
`selection.ts` ranks context and finalizes the complete byte-budgeted response.
`query.ts` composes the pipeline. `cli.ts` implements bounded JSON transport.

There is no cache, database, writeback, subprocess, Git invocation, network client,
repository configuration execution, or dependency installation in the runtime.
Bundled TypeScript and WASM parser dependencies are tool code, not repository code.

## Snapshot and Bounds

The current filesystem is authoritative, including untracked/modified files in a
Git working tree. Git index, history, attributes, filters, hooks and `.gitignore`
are not interpreted. No commit, diff, clean-tree status, or Git coverage is claimed.
Ignoring a path in Git does not make it safe to read; independent sensitive-path
exclusions apply. Excluded metadata, dependencies, generated directories and
unsupported file types are diagnosed, so `truncated` may be true even for a small
repository. Empty accessible directories produce valid empty responses.

Tooling metadata directories such as `.git`, `.codepatrol`, and `.memorypatrol` are excluded at every
level, alongside dependency directories such as `node_modules` and `vendor`.
In particular, `.codepatrol/v1` state, retained worktrees, and MemoryPatrol's
`.memorypatrol/v1` databases are not traversed;
mutating their contents cannot add files or signals, change the snapshot, or
consume the source-file/read-byte budget.

Hard analysis limits (independent of response selection): 2,000 accepted text
files, 262,144 bytes per file, 16 MiB total bytes read, 20,000 directory entries,
32 nested directories, 256 imports per file, 20,000 edges, 100 cycle representatives,
and 100 detailed diagnostics plus a suppression notice. Directory enumeration
stops and omits an entire over-limit directory rather than selecting an unstable
filesystem-order prefix. Directory children and final source files are sorted.
Files that change detectably during an individual read are omitted. There is no
atomic cross-file filesystem snapshot; use an immutable checkout for that guarantee.

`snapshot` hashes canonical JSON containing the analysis semantic identifier,
hard limits, sorted `{path,hash}` entries (hashes of raw accepted file bytes), and
source-phase diagnostics. It excludes absolute root, task, profile, response
budget, clocks, Git metadata and file timestamps. Thus identical bounded inputs
at different roots have identical snapshots, and even changes to redacted content
change the snapshot. Excluded content is deliberately not hashed. Changes outside
the bounded input may not affect it. Semantic changes require a semantic identifier
update; parser dependencies are pinned to exact versions in package.json and the npm lockfile.

## Extraction and Resolution

JS/TS use the TypeScript syntax parser for import/export declarations, type imports, import-equals,
literal `require`, and literal dynamic `import`. Comments and string contents are
not imports. Nonliteral imports are diagnosed. `require` binding shadowing is not
resolved. Python uses the bundled tree-sitter grammar for `import` and `from`
statements, aliases, multiline imports, and relative imports. Dynamic Python imports
are diagnosed, not evaluated. Syntax errors produce incomplete-analysis diagnostics.

JS/TS relative specifiers resolve against observed paths: exact file first, common
`.js` to `.ts`/`.tsx`, `.jsx` to `.tsx`, `.mjs` to `.mts`, `.cjs` to `.cts` source mappings, then
extension and directory-index candidates. These are heuristics, not execution-loader
equivalence. Package exports, tsconfig aliases, custom loaders, URLs and external
packages do not become edges. Python relative imports resolve from the containing
directory; absolute imports try root then `src/`. Modules, package `__init__.py`,
and `from` member submodules are considered. Runtime `sys.path`, namespace package
behavior, implicit ancestor initializers, conditional execution and symbol-vs-module
ambiguity are not fully modeled. An edge always points to an actually read file;
diagnostics explain approximations and unresolved imports. Selected-file reasons
include up to three literal import line/target evidence strings.

Go imports are syntax parsed and become local edges only when they are relative or
fall beneath the exact module declared in `go.mod`; external packages are not
matched by path suffix. Rust `use` and external `mod` items are syntax parsed with
conservative `crate::` and `super::` module resolution.

Signals come from extensions, dependency names in package.json, Python project
metadata, conventional paths such as next.config, imports, and recognizable content
such as FastMCP/McpServer. Signals are heuristics, never installed-stack verification.
No remote dependency is fetched and no executable manifest is evaluated.

## Graph and Selection

Impact is breadth-first reverse transitive imports from available seeds, at most
`maxDepth` hops, excluding seeds themselves. Depth zero disables impact and cycle
traversal. Cycles are representative closed paths
from deterministic DFS with at most `maxDepth` active nodes (self-loops can be
reported), not an enumeration of all elementary cycles. Limits are diagnosed.
Traversal is over the bounded input graph, before file selection. Output nodes,
edges, cycles and impacted paths are then restricted to selected files; omitted
graph evidence is explicitly diagnosed. Missing cycles never prove acyclicity.

All profiles give seeds 1,000 points, lexical path matches 20 points per term,
content matches 3, direct seed dependencies 80, and reverse impact 100 (review:
160). Task terms are lowercased ASCII alphanumeric/underscore words of at least
two characters, at most 64 unique terms. Substring matches are heuristic. Incoming
degree contributes 2 points per importer (architecture: 12), capped at 20 importers.
Overview rewards metadata by 100; architecture rewards conventional entry paths by
60; implementation rewards non-test JS/TS/Python/Go/Rust by 30; review rewards test paths
by 100. Ties use ascending path order. Reasons expose the contributions. Paths
are seeds rather than filters; unrelated fallback files may still be selected.

Excerpt windows are task-centered and redacted, with profile-specific character
caps. `scannedFiles` counts accepted UTF-8 text files, not all directory entries.
`selectedFiles` is the final returned file count. `truncated` flags exclusions,
partial excerpts, analysis limits, selection limits and output trimming, not the
accuracy of heuristics.

The finalizer signs and measures canonical UTF-8 JSON plus newline after every
change. It trims diagnostic details, excerpts, cycle representatives, edges, then
lowest-ranked files (and their nodes/impact), remaining diagnostic details, and
signals as needed. A budget-truncation diagnostic is retained. No stale digest,
dangling edge, or unsupported cycle survives trimming. Small budgets necessarily
lose evidence. This is context selection, not proof of program behavior or coverage.
