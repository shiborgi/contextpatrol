# AGENTS

ContextPatrol is developed with the CodePatrol framework (its optional
companion).

## Workflow

For every change, drive it through CodePatrol's golden path:

```
spec -> spec-review -> plan -> plan-review -> build -> build-review -> ship
```

using the `codepatrol` CLI (installed separately), with `codepatrol.json` as the
verification gate.

## Gates

- Quality gate: `npm run verify`.
- Release gate: `npm run release-check`.

## Rules

- Never hand-edit `refs/codepatrol/state`.
- Reviews must use a different harness than the producer.
- `protocol/` schemas are the public contract; keep them in sync with
  `src/contracts.ts` (guarded by `npm run check-schemas`).

## Stack

TypeScript, Node >= 22, zod, TypeScript compiler API. Build: `npm run build`.
Test: `npm run test`.
