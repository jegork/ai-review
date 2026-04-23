---
title: Environment variables
description: RUSTY_* variables read at runtime by the action and webhook server.
---

Non-secret configuration lives in `RUSTY_*` env vars rather than action inputs,
so the same values can be reused between the GitHub Action, the webhook
server, and the Azure DevOps task without duplication.

## Common

| Variable | Default | Description |
| --- | --- | --- |
| `RUSTY_LLM_MODEL` | `anthropic/claude-sonnet-4-20250514` | Provider/model in `provider/model` form. |
| `RUSTY_LLM_BASE_URL` | — | Base URL of an OpenAI-compatible endpoint (LiteLLM, Requesty, vLLM, …). |
| `RUSTY_REVIEW_STYLE` | `balanced` | One of `strict`, `balanced`, `lenient`, `roast`, `thorough`. |
| `RUSTY_FOCUS_AREAS` | _all_ | Comma-separated: `security,performance,bugs,style,tests,docs`. |
| `RUSTY_IGNORE_PATTERNS` | — | Comma-separated globs to skip (e.g. `*.lock,dist/**`). |
| `RUSTY_FAIL_ON_CRITICAL` | `true` | Exit with code 1 when critical findings are produced (gates the PR). |
| `RUSTY_GENERATE_DESCRIPTION` | `false` | Generate a PR description when it's empty or a placeholder. |
| `RUSTY_REVIEW_DRAFTS` | `false` | Review draft PRs (skipped by default). |
| `RUSTY_OPENGREP_RULES` | `auto` | OpenGrep config string (ruleset id or path). |

## Ticket compliance

| Variable | Description |
| --- | --- |
| `RUSTY_JIRA_BASE_URL` | Jira instance URL. |
| `RUSTY_JIRA_EMAIL` | Jira auth email. |
| `RUSTY_JIRA_API_TOKEN` | Jira API token (also exposed as the `jira-api-token` action input). |
| `RUSTY_LINEAR_API_KEY` | Linear API key (also exposed as the `linear-api-key` action input). |

For the canonical list, see
[`action.yml`](https://github.com/jegork/ai-review/blob/main/action.yml) and
[`.env.example`](https://github.com/jegork/ai-review/blob/main/.env.example) in
the repo.
