---
title: LLM providers
description: Connect Rusty Bot to any LLM — Anthropic, OpenAI, Azure OpenAI, or an OpenAI-compatible endpoint.
---

Rusty Bot resolves the LLM provider through four paths, tried in order. The first path whose required environment variables are set wins.

## 1. Azure OpenAI with API key

For Azure AI Foundry deployments:

```bash
RUSTY_LLM_MODEL=azure-openai/gpt-5.3-codex
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_RESOURCE_NAME=ai-code-review-foundry
```

The resource name is the subdomain from your endpoint URL — for example, `https://ai-code-review-foundry.cognitiveservices.azure.com` → `ai-code-review-foundry`. Uses `@ai-sdk/azure` directly.

## 2. Azure OpenAI with Managed Identity

No API keys needed when running on Azure:

```bash
RUSTY_AZURE_RESOURCE_NAME=my-openai-resource
RUSTY_AZURE_DEPLOYMENT=gpt-4o
```

Uses `DefaultAzureCredential` from `@azure/identity`, which automatically picks up managed identity on AKS, App Service, Azure Functions, and Azure Pipelines. Also works with `az login` locally.

## 3. OpenAI-compatible endpoint

For LiteLLM, vLLM, Ollama, or any proxy:

```bash
RUSTY_LLM_BASE_URL=http://localhost:4000/v1
RUSTY_LLM_MODEL=gpt-4o
RUSTY_LLM_API_KEY=optional-key
```

`RUSTY_LLM_API_KEY` is optional; omit it for unauthenticated local endpoints.

## 4. Mastra router (default)

Direct provider API keys with 99+ providers supported:

```bash
RUSTY_LLM_MODEL=anthropic/claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...
```

Other supported providers: `openai/gpt-4o`, `google/gemini-2.5-flash`, `openrouter/...`, and many more. Set the matching API key (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, etc.) for whichever model you choose.

## Temperature and top-p

Set global defaults for all agents, or override per agent. Per-agent values take priority over the global setting; omitting any value falls back to the provider default.

```bash
# global defaults
RUSTY_LLM_TEMPERATURE=0.3
RUSTY_LLM_TOP_P=0.9

# per-agent overrides
RUSTY_REVIEW_TEMPERATURE=0.3
RUSTY_TRIAGE_TEMPERATURE=0
RUSTY_JUDGE_TEMPERATURE=0
RUSTY_DESCRIPTION_TEMPERATURE=0.5
```

Some models enforce a fixed temperature — for example, `moonshot/kimi-k2.5` only accepts `temperature=1`. Use per-agent overrides when running different models per agent to work around such restrictions.
