---
title: Cascading review
description: Use a cheap triage model to classify files before review, cutting token usage by 30–50%.
---

By default every file in a PR gets the same deep review treatment. Cascading adds a triage step that classifies each file as `skip`, `skim`, or `deep-review` before the main review runs, so cheap files don't consume the same token budget as critical ones.

## Tiers

| Tier | What happens |
| --- | --- |
| `skip` | File is excluded entirely — lock files, auto-generated code, vendored deps |
| `skim` | Lightweight single-pass review — diff-only context, no tools, simplified output schema (no `suggestedFix`, no ticket compliance) |
| `deep-review` | Full review pipeline — tree-sitter context expansion, code search tools, consensus voting, ticket compliance |

## Enabling it

Set a triage model to enable cascading automatically:

```bash
RUSTY_LLM_TRIAGE_MODEL=anthropic/claude-3-5-haiku-20241022
```

Or toggle explicitly:

```bash
RUSTY_CASCADE_ENABLED=true   # force on (requires RUSTY_LLM_TRIAGE_MODEL)
RUSTY_CASCADE_ENABLED=false  # force off even if triage model is set
```

## How it works

1. The triage agent receives a truncated version of each file's diff (≤200 tokens per file, 30k token budget total) and classifies it
2. Files that overflow the triage budget default to `deep-review`
3. Files the triage model misses also default to `deep-review`
4. Safety net: if triage classifies all files as `skip`, the top 20% by additions are force-promoted to `deep-review`
5. Skim-tier and deep-tier files are reviewed in parallel
6. Results from both tiers are merged, then passed through the judge (if enabled)
7. If triage fails entirely, the bot falls back to the standard full-review pipeline

## Summary comment

When cascading is active, the PR comment includes a collapsible **Triage Summary** showing how many files were skipped, skimmed, and deep-reviewed, plus the triage model and token usage.

## Cost

The triage call itself is cheap — truncated diffs and a small output schema. The savings come from skipping context expansion and tool calls for skim-tier files. For a typical PR where roughly 40% of files are config, docs, or tests, expect around 30–50% token reduction on the review calls.
