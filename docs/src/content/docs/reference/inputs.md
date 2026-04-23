---
title: Action inputs
description: Inputs accepted by the jegork/ai-review GitHub Action.
---

Pass these via the `with:` block of the action step. Only `github-token` is
required; everything else is optional and depends on which providers you use.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | yes | `${{ github.token }}` | Token for reading the PR diff and posting comments. Requires `pull-requests:write`, `issues:read`, `contents:read`. |
| `anthropic-api-key` | no | — | Set when `RUSTY_LLM_MODEL` targets `anthropic/*`. |
| `openai-api-key` | no | — | Set when `RUSTY_LLM_MODEL` targets `openai/*`. |
| `google-api-key` | no | — | Set when `RUSTY_LLM_MODEL` targets `google/*`. |
| `azure-openai-api-key` | no | — | Set when `RUSTY_LLM_MODEL` targets `azure-openai/*`. |
| `llm-api-key` | no | — | Generic API key for any OpenAI-compatible endpoint specified via `RUSTY_LLM_BASE_URL` (LiteLLM, Requesty, vLLM, etc.). |
| `jira-api-token` | no | — | Jira API token for ticket-compliance checks. |
| `linear-api-key` | no | — | Linear API key for ticket-compliance checks. |

Non-secret configuration is set per-step via `RUSTY_*` env vars — see
[Environment variables](/reference/env-vars/).
