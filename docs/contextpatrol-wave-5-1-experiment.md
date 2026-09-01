# ContextPatrol WAVE-5.1 Experiment Guide

This guide evaluates ContextPatrol context recipes. It is an experiment plan,
not a change to the query contract or a claim that one recipe is universally
best.

## Recipe Table

Stage-typed recipes are the catalog. They use the signal most relevant to a
kind of analysis while omitting signals that can distract from that purpose.
The WAVE-5.1 controlled paired protocol remains the evaluation methodology;
stage names do not add metadata to a ContextPatrol request or report.

| Profile | Facets | Depth | Max output bytes |
| --- | --- | --- | ---: |
| `spec-survey` | `[structure, symbols, source]` | `signatures` | `12800` |
| `spec-deep` | `[structure, symbols, relations]` | | `19200` |
| `plan-impact` | `[changes, symbols, relations, tests]` | | `19200` |
| `plan-deep` | `[changes, symbols, relations, source, tests]` | | `24000` |
| `build-work` | `[symbols, source, tests]` | | `19200` |
| `build-deep` | `[symbols, relations, source, tests]` | | `24000` |
| `review-diff` | `[changes, symbols, relations, tests]` | | `12800` |
| `review-grounded` | `[changes, symbols, relations, source, tests]` | | `19200` |
| `readiness` | `[changes, tests, relations]` | | `9600` |

The spec recipes emphasize repository shape and declared symbols. `spec-survey`
adds signature excerpts and omits relations to keep the initial map focused,
while `spec-deep` adds relations for a more connected structural view. The plan
recipes emphasize changes, dependencies, and test signals; `plan-impact` omits
source excerpts to reduce detail that can obscure change boundaries, while
`plan-deep` adds source for cases that need implementation evidence.

The build recipes emphasize symbols, source, and tests. `build-work` omits
relations to leave more budget for implementation excerpts, while `build-deep`
adds relations when dependency context is useful. The review recipes emphasize
changes and relations. `review-diff` includes test signals for a compact
structural comparison, while `review-grounded` adds source excerpts for a
broader evidence set. `readiness` is the ship recipe: changes, tests, and
relations only. All recipes remain bounded and advisory; none is required or
authoritative.

## Intended Evidence

The experiment is intended to establish whether the recipes provide useful,
distinct evidence for three context needs:

- Spec recipes should expose a stable structural map, with `spec-survey`
  adding signature excerpts without relations.
- Build recipes should combine symbols, source excerpts, and test signals
  for implementation work.
- Plan and review recipes should distinguish changed paths and test gaps,
  with `plan-deep` and `review-grounded` adding source excerpts.

Evidence should come from fixed repository snapshots and externally verifiable
task outcomes. A report that is larger, more detailed, or preferred by a human
is not by itself evidence of better task support.

## Controlled Paired Protocol

1. Freeze a repository snapshot, its baseline commit, a task set, and one query
   per task before collecting results. Use the same target and baseline for
   every recipe in a pair.
2. Compare `spec-survey` with `spec-deep`, `plan-impact` with `plan-deep`,
   `build-work` with `build-deep`, and `review-diff` with `review-grounded`.
3. Keep the task wording, source include/exclude paths, output budget, model,
   tool permissions, and acceptance tests fixed within each pair. Do not add
   profile or experiment metadata to a ContextPatrol request.
4. Alternate the execution order of paired recipes and repeat each task and
   recipe at least three times. Record the profile name outside the report;
   report digests and output bytes are the only ContextPatrol values needed for
   repeatability checks.
5. Evaluate task results against the pre-written acceptance tests without
   exposing the profile name to the evaluator where practical. Report paired
   differences per task before aggregating them.

## Objective Metrics

Use the following metrics with definitions fixed before the experiment:

- **Task success rate:** the number of runs that pass all pre-written
  acceptance tests divided by the number of runs, reported per profile and as
  a paired difference.
- **Relevant-path recall:** `|R intersect P| / |R|`, where `R` is the pre-written
  set of paths required by a task and `P` is the union of paths in report files,
  symbols, relations, snippets, changes, and test signals. Report the result
  per task and at `k` selected paths when applicable.
- **Test-signal recall and precision:** against a pre-written oracle of test
  files and changed source paths without tests, report true positives divided
  by oracle positives and true positives divided by reported positives.
- **Budget utilization:** `outputBytes / maxOutputBytes`, with every run also
  checked for `outputBytes <= maxOutputBytes`.
- **Digest repeatability:** the fraction of repeated runs whose complete report
  and `reportDigest` are identical for the same target, baseline, query, and
  recipe.
- **Wall-clock latency:** measure process wall time for each query and report
  median and p95 separately for cold and warm cache runs. Do not mix cache
  conditions in one aggregate.

## Advisory Boundary

ContextPatrol remains a deterministic, read-only, local analysis provider.
These profiles select bounded context facets; they do not decide whether work
is correct, authorize a change, identify a caller or agent, carry lifecycle or
orchestration state, or replace tests and review. Reports are advisory-only
context for a separate consumer. The public request and report schemas remain
free of experiment, caller, lifecycle, and agent fields.

## First-Party Inspiration

These links are clearly labeled first-party background inspiration, not
dependencies, benchmarks, or evidence for this experiment:

- Aider first-party documentation: [repository map](https://aider.chat/docs/repomap.html)
- Sourcegraph Cody first-party documentation: [context](https://sourcegraph.com/docs/cody/core-concepts/context)
