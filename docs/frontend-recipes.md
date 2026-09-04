# Frontend Recipes (`ui-surface`, `ui-tokens`, `ui-flow`)

Caller-side recipes for frontend Works. Each recipe has two parts, kept
distinct because the contracts are distinct:

- (a) **Stored profile** in `codepatrol.json:contextPatrol.profiles`: only
  `facets`, `maxOutputBytes`, and `sourceDepth`. No schema change.
- (b) **Query-time hints** below: `ranking` and `includePaths` from
  `schemas/query-request.schema.json`. Pass them on each
  `query --input -` request; they are never stored in the profile and they
  participate in `requestDigest`, so identical requests repeat
  byte-for-byte.

`defaults` mapping is unchanged: callers opt into `ui-*` per query with
`--context-profile <name>` plus hints (b).

## `ui-surface` — component implementation evidence

Stored profile (a):

```json
{
  "facets": ["symbols", "relations", "source", "tests"],
  "maxOutputBytes": 19200
}
```

Query-time hints (b):

```json
{
  "ranking": {
    "boostPaths": ["src/components", "app/", "packages/ui/src"],
    "dampenPaths": ["dist", ".next", "storybook-static"],
    "boostIdents": ["props", "variant"]
  }
}
```

Use for Works touching components, dialogs, tables, or charts.

## `ui-tokens` — token-only styling proof

Stored profile (a):

```json
{
  "facets": ["structure", "symbols", "source"],
  "maxOutputBytes": 12800,
  "sourceDepth": "signatures"
}
```

Query-time hints (b):

```json
{
  "includePaths": [
    "packages/ui/src/tokens.ts",
    "packages/ui/src/*.tsx",
    "apps/web/src/app/layout.tsx"
  ]
}
```

Use to prove styling resolves to shared tokens. On Lastro, `snippets`
must include `packages/ui/src/tokens.ts`.

## `ui-flow` — route-to-client-to-e2e trace

Stored profile (a):

```json
{
  "facets": ["structure", "relations", "source", "tests"],
  "maxOutputBytes": 19200
}
```

Query-time hints (b):

```json
{
  "includePaths": [
    "apps/web/src/app/page.tsx",
    "apps/web/src/lib/api.ts",
    "apps/web/e2e/expense-workflow.spec.ts"
  ]
}
```

Use for Works touching routes, data clients, or end-to-end flows.
