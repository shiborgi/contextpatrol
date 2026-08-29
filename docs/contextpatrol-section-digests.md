# ContextPatrol Section Digests

This reference defines the opt-in section-fingerprint protocol. It is an
additive capability: requests that omit the switch behave exactly as before,
byte for byte.

## Request

Add the optional boolean `includeSectionDigests` to a query request:

```json
{
  "schemaVersion": 1,
  "workspace": "/absolute/path/to/repository",
  "query": "locate token validation and its callers",
  "facets": ["structure", "symbols", "relations", "source"],
  "maxOutputBytes": 9600,
  "target": { "kind": "working-tree" },
  "includeSectionDigests": true
}
```

`true` requests the section digests. `false` canonicalizes to omission, so an
explicit `false` and an omitted field produce the identical canonical request,
`requestDigest`, and report bytes as a pre-feature request. The field is part of
the canonical request and is covered by `requestDigest`.

## Report

When opted in, the report appends a `sectionDigests` object with exactly seven
keys in lexical order:

```json
{
  "sectionDigests": {
    "changes": "sha256:...",
    "coverage": "sha256:...",
    "files": "sha256:...",
    "relations": "sha256:...",
    "snippets": "sha256:...",
    "symbols": "sha256:...",
    "tests": "sha256:..."
  }
}
```

The keys are `changes`, `coverage`, `files`, `relations`, `snippets`,
`symbols`, and `tests`. Every key is always present when the switch is on,
regardless of which facets were requested.

## Preimage

Each digest is the UTF-8 SHA-256 of the canonical JSON value:

```json
{
  "domain": "contextpatrol.section-digest.v1",
  "schemaVersion": 1,
  "section": "<key>",
  "value": "<final emitted section>"
}
```

- `domain` is the literal string `contextpatrol.section-digest.v1`.
- `schemaVersion` is the integer `1`.
- `section` is the report key being fingerprinted, one of the seven keys above.
- `value` is the final, consumer-visible section value from the emitted report.

## Canonical JSON

The preimage is serialized with the same canonical JSON rules as the rest of
the report:

- Object keys are ordered recursively by UTF-8 byte value.
- Array order is preserved exactly as emitted.
- Strings are UTF-8 encoded.
- The CLI newline appended to stdout is not part of any digest preimage.

## Timing

Digests are computed from the final emitted section values, after budget
finalization. Trimming and coverage omission counters settle first, so every
digest describes exactly the corresponding consumer-visible section. The
`sectionDigests` object itself participates in the output budget and in
`maxOutputBytes`.

## Self-reference

- `reportDigest` hashes the complete finalized report except `reportDigest`
  itself.
- Each section digest excludes `sectionDigests` and `reportDigest`; a section
  digest never hashes digest metadata.

## Empty-value rule

A facet that was not requested is emitted as its existing empty value, and that
empty value is what is hashed. For example, when the `source` facet is omitted,
`snippets` is `[]` and the `snippets` digest hashes `{domain: ...,
section: "snippets", value: []}`. The same rule applies to every unrequested
facet, so all seven keys are always present and deterministic.

## Repeatability

Repeated clean and dirty-worktree queries with identical effective input
produce identical section digests. Changing one section changes that section's
digest while unchanged section digests remain stable.

## What equality proves

Section digests compare neutral emitted context only. Equality of a digest
covers only the final emitted section value for that key. It does not:

- identify an execution or a caller;
- establish semantic equivalence beyond the report;
- judge quality;
- rank candidates;
- choose a winner;
- authorize lifecycle transitions.

ContextPatrol remains a deterministic, read-only, local analysis provider. The
public request and report schemas remain free of lifecycle, execution identity,
comparison, and selection fields.
