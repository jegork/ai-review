# Rusty Bot

AI-powered PR review bot with configurable review styles, focus areas, and ticket compliance checking. Works with GitHub and Azure DevOps.

Built on [Mastra](https://mastra.ai/) (TypeScript).

## Features

- **4 review styles** — Strict, Balanced, Lenient, Roast
- **6 focus areas** — Security, Performance, Bugs, Code Style, Test Coverage, Documentation
- **Structured summary comments** — severity table, collapsible issue details, files reviewed
- **Inline code comments** — findings posted directly on PR diff lines
- **Ticket compliance** — extracts linked tickets from PR description/branch name, checks if requirements are addressed
- **Multi-provider LLM** — OpenAI, Anthropic, Google, or any provider supported by Mastra
- **GitHub + Azure DevOps** — webhook server for GitHub, pipeline task for Azure DevOps
- **Web dashboard** — configure repos, review styles, focus areas, and view history

## Quick Start

```bash
# install dependencies
pnpm install

# build all packages
pnpm -r build

# copy env template and configure
cp .env.example .env
# edit .env — set at least one LLM API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)

# start the server
pnpm --filter @rusty-bot/github start
```

Server runs on `http://localhost:3000`. Dashboard is at `/`, health check at `/health`.

## Quick Start (Podman)

```bash
cp .env.example .env
# edit .env with your API keys

podman compose up --build
```

## Project Structure

```
packages/
├── core/           # shared review engine
│   ├── src/
│   │   ├── agent/      # Mastra review agent, prompt templates, Zod output schema
│   │   ├── diff/       # unified diff parser, file filter, token-aware compression
│   │   ├── formatter/  # summary comment + inline comment markdown renderers
│   │   ├── tickets/    # ticket ref extraction, providers (GitHub/Jira/Linear/ADO)
│   │   └── types.ts    # shared type definitions
│   └── src/prompts/    # externalized prompt templates (styles + focus areas)
├── github/         # GitHub App webhook server + config API
├── azure-devops/   # Azure DevOps pipeline task (Docker entrypoint)
└── dashboard/      # React SPA for configuration and review history
```

## GitHub App Setup

1. Create a GitHub App at `https://github.com/settings/apps/new` or use the provided `github-app-manifest.json`
2. Required permissions:
   - **Pull requests**: Read & Write
   - **Issues**: Read
   - **Contents**: Read
3. Subscribe to the **Pull request** event
4. Generate a private key and download it
5. Set environment variables:

```bash
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY_PATH=./private-key.pem
GITHUB_WEBHOOK_SECRET=your-secret
```

6. Point the webhook URL to `https://your-domain/api/webhooks/github`
7. Install the app on your repositories

## Azure DevOps Pipeline Setup

Rusty Bot runs inside a container in Azure Pipelines. The pipeline env vars (`SYSTEM_PULLREQUEST_*`, etc.) are automatically available inside the container.

```yaml
trigger: none

pr:
  branches:
    include:
      - main

pool:
  vmImage: ubuntu-latest

container:
  image: ghcr.io/jegork/ai-review:latest
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

Set `RUSTY_LLM_MODEL`, `ANTHROPIC_API_KEY`, and other variables as pipeline variables in Azure DevOps. For Azure OpenAI with managed identity, replace the API key vars with `RUSTY_AZURE_RESOURCE_NAME` and `RUSTY_AZURE_DEPLOYMENT`.

The task exits with code 1 when critical issues are found (configurable via `RUSTY_FAIL_ON_CRITICAL`), which can gate PR merges.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RUSTY_LLM_MODEL` | LLM model in `provider/model` format | `anthropic/claude-sonnet-4-20250514` |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI API key | — |
| `RUSTY_DB_URL` | libSQL database URL | `file:./rusty.db` |
| `GITHUB_APP_ID` | GitHub App ID | — |
| `GITHUB_PRIVATE_KEY_PATH` | path to GitHub App private key PEM | — |
| `GITHUB_PRIVATE_KEY` | inline PEM (alternative to path) | — |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook secret | — |
| `RUSTY_REVIEW_STYLE` | default review style | `balanced` |
| `RUSTY_FOCUS_AREAS` | comma-separated focus areas | all enabled |
| `RUSTY_IGNORE_PATTERNS` | comma-separated glob patterns to skip | — |
| `RUSTY_FAIL_ON_CRITICAL` | exit 1 on critical findings (pipeline mode) | `true` |
| `RUSTY_JIRA_BASE_URL` | Jira instance URL | — |
| `RUSTY_JIRA_EMAIL` | Jira auth email | — |
| `RUSTY_JIRA_API_TOKEN` | Jira API token | — |
| `RUSTY_LINEAR_API_KEY` | Linear API key | — |
| `RUSTY_ADO_PAT` | Azure DevOps PAT (server mode) | — |
| `RUSTY_AZURE_RESOURCE_NAME` | Azure OpenAI resource name (managed identity) | — |
| `RUSTY_AZURE_DEPLOYMENT` | Azure OpenAI deployment name (managed identity) | — |
| `RUSTY_LLM_BASE_URL` | OpenAI-compatible endpoint URL (e.g. LiteLLM) | — |
| `RUSTY_LLM_API_KEY` | API key for custom endpoint | — |

### LLM Provider Configuration

Rusty Bot supports three ways to connect to an LLM:

**1. Mastra model router (default)** — direct provider API keys:
```bash
RUSTY_LLM_MODEL=anthropic/claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...
```

Supports 99+ providers: `openai/gpt-4o`, `google/gemini-2.5-flash`, `azure-openai/deployment-name`, `openrouter/...`, etc.

**2. Azure OpenAI with Managed Identity** — no API keys needed when running on Azure:
```bash
RUSTY_AZURE_RESOURCE_NAME=my-openai-resource
RUSTY_AZURE_DEPLOYMENT=gpt-4o
```

Uses `DefaultAzureCredential` from `@azure/identity`, which automatically picks up managed identity in Azure VMs, AKS, App Service, Azure Functions, and Azure Pipelines. Also works with `az login` locally.

**3. OpenAI-compatible endpoint** — for LiteLLM, vLLM, Ollama, or any proxy:
```bash
RUSTY_LLM_BASE_URL=http://localhost:4000/v1
RUSTY_LLM_MODEL=gpt-4o
RUSTY_LLM_API_KEY=optional-key
```

Priority: Azure managed identity > custom endpoint > model router string.

### Per-Repository Configuration

Configure via the web dashboard at `http://localhost:3000` or the API:

```bash
# set repo config
curl -X PUT http://localhost:3000/api/config/repos/owner/repo \
  -H "Content-Type: application/json" \
  -d '{
    "style": "roast",
    "focusAreas": ["security", "bugs", "performance"],
    "ignorePatterns": ["*.generated.ts", "vendor/**"],
    "customInstructions": "This repo uses Effect-TS, review accordingly"
  }'
```

### Review Styles

| Style | Behavior |
|-------|----------|
| **Strict** | Flags all potential issues, prioritizes quality and security |
| **Balanced** | Focuses on confidence, balances thoroughness with practicality |
| **Lenient** | Only critical bugs and security issues, encouraging tone |
| **Roast** | Technically accurate feedback wrapped in sharp, witty commentary |

### Ticket Integration

Rusty Bot automatically extracts ticket references from PR descriptions and branch names:

- **GitHub Issues**: `#123`, `owner/repo#123`, full URL
- **Jira**: `PROJ-123`, Jira browse URL
- **Linear**: Linear issue URL
- **Azure DevOps**: `AB#123`, ADO work item URL
- **Branch names**: `feature/123-desc`, `fix/PROJ-123-title`

When tickets are found and the corresponding provider is configured, the review summary includes a compliance assessment.

## Development

```bash
# install
pnpm install

# build all packages
pnpm -r build

# run tests (164 tests)
pnpm test

# start dev server
pnpm --filter @rusty-bot/github start

# start dashboard dev server (with hot reload)
pnpm --filter @rusty-bot/dashboard dev
```

## License

MIT
