---
title: GitHub Action
description: Run Rusty Bot as a drop-in GitHub Action — no hosting required.
---

The GitHub Action is the easiest way to get started. Reviews run on GitHub-hosted runners — no server to provision or maintain.

## Minimal workflow

Create `.github/workflows/rusty-bot-review.yml`:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
      issues: read
    steps:
      - uses: jegork/ai-review@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
        env:
          RUSTY_LLM_MODEL: anthropic/claude-sonnet-4-20250514
          RUSTY_REVIEW_STYLE: balanced
          RUSTY_FOCUS_AREAS: security,bugs,performance
          RUSTY_FAIL_ON_CRITICAL: "true"
```

The [Getting started](/getting-started/) page has the bare minimum to get running. This page is the complete reference.

## Required permissions

Set these on the job (not the whole workflow):

| Permission | Reason |
| --- | --- |
| `pull-requests: write` | Post the summary comment and inline review findings |
| `issues: read` | Read linked issues for ticket compliance checks |
| `contents: read` | Read the diff and fetch the convention file from the target branch |

## Inputs reference

Secret-bearing inputs only — everything else flows through `env:`. See [Environment variables](/reference/env-vars/) for non-secret config.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | No | `${{ github.token }}` | GitHub token; the built-in token works when the `permissions:` block above is set |
| `anthropic-api-key` | Conditional | — | Required when `RUSTY_LLM_MODEL` targets an `anthropic/*` model |
| `openai-api-key` | Conditional | — | Required when `RUSTY_LLM_MODEL` targets an `openai/*` model |
| `google-api-key` | Conditional | — | Required when `RUSTY_LLM_MODEL` targets a `google/*` model |
| `azure-openai-api-key` | Conditional | — | Required when `RUSTY_LLM_MODEL` targets an `azure-openai/*` model |
| `llm-api-key` | Conditional | — | API key for an OpenAI-compatible endpoint (set together with `RUSTY_LLM_BASE_URL`) |
| `jira-api-token` | No | — | Enable Jira ticket compliance; combine with `RUSTY_JIRA_BASE_URL` + `RUSTY_JIRA_EMAIL` |
| `linear-api-key` | No | — | Enable Linear ticket compliance |

## Pinning

| Pin | Behaviour |
| --- | --- |
| `@v1` | Floats to the latest `1.x.x` release. **Recommended.** |
| `@v1.2.3` | Pinned to an exact release. |
| `@main` | Tracks `main`. Use only for development. |

## Skipped events

The Action exits early (no error, no review) for these PR event types:

- `closed`, `labeled`, `unlabeled`, `assigned`, `unassigned`
- Draft PRs — unless `RUSTY_REVIEW_DRAFTS=true` is set in `env:`

## Docker image

The Action runs inside `ghcr.io/jegork/ai-review:latest`, which includes OpenGrep. The first run in a fresh runner environment adds roughly 20–40s for the image pull; subsequent runs on cached runners skip this entirely.
