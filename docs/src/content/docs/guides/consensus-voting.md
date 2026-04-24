---
title: Consensus voting
description: Run multiple independent review passes and keep only findings that appear in a majority — reduces false positives.
---

By default, each review runs 3 independent passes with shuffled diff ordering (file and hunk order randomized per pass). Findings are clustered across passes using file match, line proximity (±5 lines), and message similarity (Jaccard ≥ 0.3). Only findings that appear in a majority of passes survive — the rest are dropped as likely false positives.

## Configuration

Configure via per-repo config in the dashboard or API:

| Setting | Description | Default |
| --- | --- | --- |
| `consensusPasses` | Number of independent review passes (set to `1` to disable) | `3` |
| `consensusThreshold` | Minimum votes to keep a finding | `ceil(passes/2)` |

## How it works

1. The diff is shuffled N times (seeded PRNG for reproducibility) to produce N different orderings
2. Each ordering is reviewed independently in parallel
3. Findings from all passes are clustered by file + line proximity + message similarity
4. Clusters with votes below the threshold are dropped
5. Surviving findings include a `voteCount` showing how many passes flagged them

## Fault tolerance

Consensus uses `Promise.allSettled` so a single flaky pass does not fail the whole review:

- Each pass retries once on `STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED` (common with models that have inconsistent structured-output support). Other errors are not retried.
- If at least `consensusThreshold` passes succeed, consensus is formed from the surviving passes and `consensusMetadata.failedPasses` records how many threw.
- If fewer than `consensusThreshold` passes succeed, the review throws an `AggregateError` containing every pass failure.

## Cost

With the default 3 passes, LLM cost per review triples. Combine with [cascading review](/guides/cascading-review/) and/or the [judge pass](/guides/judge-pass/) (using a cheaper model) to offset costs.

## Disabling

Set `consensusPasses` to `1` to get the original single-pass behaviour with zero overhead.
