---
title: Azure DevOps
description: Run Rusty Bot as a container task in Azure Pipelines.
---

Azure DevOps is a first-class integration alongside GitHub. Rusty Bot runs as a container task in Azure Pipelines, reads `SYSTEM_PULLREQUEST_*` variables automatically, and gates merges via exit code.

## Prerequisites

- An Azure DevOps project with a pipeline that targets pull requests
- "Allow scripts to access the OAuth token" must be enabled for the agent pool (Settings → Agent pool → Allow in the pipeline settings), so `$(System.AccessToken)` can post comments on PRs

## Minimal pipeline YAML

```yaml
trigger: none

pr:
  branches:
    include:
      - main

pool:
  vmImage: ubuntu-latest

container:
  image: ghcr.io/jegork/rusty-bot:latest
  env:
    RUSTY_MODE: pipeline

steps:
  - script: node /app/packages/azure-devops/dist/cli.js
    displayName: Rusty Bot PR Review
    env:
      SYSTEM_ACCESSTOKEN: $(System.AccessToken)
      RUSTY_LLM_MODEL: $(RUSTY_LLM_MODEL)
      ANTHROPIC_API_KEY: $(ANTHROPIC_API_KEY)
      RUSTY_REVIEW_STYLE: $(RUSTY_REVIEW_STYLE)
      RUSTY_FOCUS_AREAS: $(RUSTY_FOCUS_AREAS)
      RUSTY_FAIL_ON_CRITICAL: "true"
```

## LLM provider

**Direct API key** — set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) as a pipeline variable in Azure DevOps and pass it through `env:` as shown above.

**Azure OpenAI with Managed Identity** — replace the API key vars with:

```bash
RUSTY_AZURE_RESOURCE_NAME=my-openai-resource
RUSTY_AZURE_DEPLOYMENT=gpt-4o
```

No key needed; `DefaultAzureCredential` picks up the managed identity automatically when the pipeline runs on Azure. See [LLM providers](/guides/llm-providers/) for full details.

## Gating merges

Add `RUSTY_FAIL_ON_CRITICAL: "true"` to the step `env:` (already in the example above). The task exits with code 1 when critical findings are found, which fails the pipeline job.

To block PR merges, add a build validation policy: **Project Settings → Repositories → Policies → Branch policies → Build validation**, and point it to the Rusty Bot pipeline.

See [Gating merges](/guides/gating-merges/) for the full setup walkthrough.

## ADO PAT fallback

For non-container usage (e.g. server mode), set `RUSTY_ADO_PAT` with a Personal Access Token that has **Code: Read** and **Pull Request Threads: Read & Write** scopes. In pipeline mode the `$(System.AccessToken)` is preferred and no PAT is needed.
