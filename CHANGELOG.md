# Changelog

## Unreleased

- Keep only stage-typed recipes plus `readiness`. Drop unused aliases
  (`orientation`, `implementation`, `impact`, and the WAVE-5.1 wide/grounded
  names). `spec-survey` now includes signature excerpts; `review-diff` includes
  test signals; plan defaults to `plan-deep`.
- Split camelCase and underscored identifiers in query terms.
- Add a [controlled experiment
  guide](docs/contextpatrol-wave-5-1-experiment.md) for the remaining recipes.
- Add optional `sourceDepth` and `ranking` request fields with deterministic,
  bounded behavior.
- Rank files using query-term hits in file content as well as path and declared
  symbol terms.
- Adopt family documentation, GitHub issue and pull-request templates, matrix
  CI, and Biome 2.5.8.
- Add an opt-in `includeSectionDigests` request field that appends a strict
  `sectionDigests` object of SHA-256 fingerprints for the emitted report
  sections, with a [protocol reference](docs/contextpatrol-section-digests.md).

## 1.0.0

Clean standalone release requiring Node.js 22 or newer.

- Deterministic, read-only code context analysis for software agents.
- Bounded reports of structure, symbols, relations, source, changes, and tests.
- Content-addressed structural facts stored only in the user cache.
- Strict versioned input, canonical JSON output, and exact output-byte budgets.
- No lifecycle vocabulary, caller IDs, or orchestrator state in the public
  protocol.
