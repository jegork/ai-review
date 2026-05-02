---
title: Consensus voting
description: Run multiple independent review passes and keep only findings that appear in a majority — reduces false positives.
---

By default, each review runs 3 independent passes with shuffled diff ordering (file and hunk order randomized per pass). Findings are clustered across passes using file match, line proximity (±5 lines), and message similarity (Jaccard ≥ 0.3). Only findings that appear in a majority of passes survive — the rest are dropped as likely false positives.

## Configuration

Configure via per-repo config in the dashboard or API:

| Setting              | Description                                                 | Default                               |
| -------------------- | ----------------------------------------------------------- | ------------------------------------- |
| `consensusPasses`    | Number of independent review passes (set to `1` to disable) | `3`                                   |
| `consensusThreshold` | Minimum votes to keep a finding                             | strict majority (`floor(passes/2)+1`) |

You can also set per-pass review models with `RUSTY_REVIEW_MODELS`, for example:

```bash
RUSTY_REVIEW_MODELS=anthropic/claude-sonnet-4-20250514,openai/gpt-5-mini,google/gemini-3.1-pro
RUSTY_REVIEW_TEMPERATURES=0.2,0.2,0.3
```

When fewer models are provided than passes, missing entries fall back to `RUSTY_LLM_MODEL`.

Example balanced multi-model setup:

```bash
RUSTY_LLM_TRIAGE_MODEL=requesty/google/gemini-3.1-flash-lite-preview
RUSTY_REVIEW_MODELS=requesty/anthropic/claude-sonnet-4-6,requesty/openai/gpt-5-mini,requesty/google/gemini-3.1-pro
RUSTY_REVIEW_TEMPERATURES=0.2,0.2,0.3
RUSTY_JUDGE_MODEL=requesty/anthropic/claude-sonnet-4-6
RUSTY_JUDGE_TEMPERATURE=0
RUSTY_REVIEW_ADAPTIVE_PASSES=true
```

Treat model IDs as provider-specific configuration. If your router uses different current aliases, keep the same role split: cheap structured model for triage, diverse review models for consensus, and a well-calibrated model for the judge.

Adaptive pass planning is opt-in:

```bash
RUSTY_REVIEW_ADAPTIVE_PASSES=true
```

With adaptive planning enabled, ordinary deep-review chunks use 2 passes, while large or security-sensitive chunks keep up to 3 passes. Explicit `consensusPasses` still caps the maximum number of passes.

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
