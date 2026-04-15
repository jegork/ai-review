# Rusty Bot

AI-powered PR review bot with configurable review styles, focus areas, and ticket compliance checking. Works with GitHub and Azure DevOps.

Built on [Mastra](https://mastra.ai/) (TypeScript).

## Features

- **5 review styles** — Strict, Balanced, Lenient, Roast, Thorough
- **6 focus areas** — Security, Performance, Bugs, Code Style, Test Coverage, Documentation
- **Triage-driven cascading review** — cheap model classifies files as skip/skim/deep-review, each tier gets an appropriate level of scrutiny
- **Tree-sitter context expansion** — hunks expand to enclosing function/class boundaries instead of fixed line counts (TS, JS, Python, Go, Java, Rust)
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
│   │   ├── agent/      # Mastra review agent, judge/filter pass, prompt templates, Zod output schema
│   │   ├── diff/       # unified diff parser, tree-sitter context expansion, file filter, token-aware compression
│   │   ├── formatter/  # summary comment + inline comment markdown renderers
│   │   ├── triage/     # file classification for cascading review (skip/skim/deep-review)
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
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key (or `AZURE_API_KEY`) | — |
| `AZURE_OPENAI_RESOURCE_NAME` | Azure OpenAI resource name | — |
| `RUSTY_AZURE_RESOURCE_NAME` | Azure OpenAI resource (managed identity mode) | — |
| `RUSTY_AZURE_DEPLOYMENT` | Azure OpenAI deployment (managed identity mode) | — |
| `RUSTY_LLM_BASE_URL` | OpenAI-compatible endpoint URL (e.g. LiteLLM) | — |
| `RUSTY_LLM_API_KEY` | API key for custom endpoint | — |
| `RUSTY_JUDGE_ENABLED` | enable post-generation judge/filter pass | `false` |
| `RUSTY_JUDGE_THRESHOLD` | minimum confidence score (0–10) to keep a finding | `6` |
| `RUSTY_JUDGE_MODEL` | model for the judge (can be cheaper than reviewer) | same as `RUSTY_LLM_MODEL` |
| `RUSTY_LLM_TRIAGE_MODEL` | LLM model for triage classification (enables cascading) | — |
| `RUSTY_CASCADE_ENABLED` | explicitly enable/disable cascading (`true`/`false`) | auto (enabled when triage model is set) |

### LLM Provider Configuration

Rusty Bot supports four ways to connect to an LLM, resolved in this order:

**1. Azure OpenAI with API key** — for Azure AI Foundry deployments:
```bash
RUSTY_LLM_MODEL=azure-openai/gpt-5.3-codex
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_RESOURCE_NAME=ai-code-review-foundry
```

The resource name is the subdomain from your endpoint URL (e.g. `https://ai-code-review-foundry.cognitiveservices.azure.com` → `ai-code-review-foundry`). Uses `@ai-sdk/azure` directly.

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

**4. Mastra model router (default)** — direct provider API keys:
```bash
RUSTY_LLM_MODEL=anthropic/claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...
```

Supports 99+ providers: `openai/gpt-4o`, `google/gemini-2.5-flash`, `openrouter/...`, etc.

### Per-Repository Configuration

Configure via the web dashboard at `http://localhost:3000` or the API:

```bash
# set repo config
curl -X PUT http://localhost:3000/api/config/repos/owner/repo \
  -H "Content-Type: application/json" \
  -d '{
    "style": "roast",
    "focusAreas": ["security", "bugs", "performance"],
    "ignorePatterns": ["*.generated.ts", "vendor/**"]
  }'
```

### Convention Files

Check in a markdown file to your repo root to provide review instructions:

| File | Priority |
|------|----------|
| `.rusty-bot.md` | Highest |
| `REVIEW-BOT.md` | Medium |
| `AGENTS.md` | Lowest |

The bot picks up the first file found (winner-takes-all) and injects its content into the system prompt. The file is fetched from the **target branch** so PR authors cannot tamper with review rules.

Example `.rusty-bot.md`:

```markdown
- We use Effect-TS, don't flag `.pipe()` chains as complexity issues
- All API endpoints must have Zod validation — flag missing schemas as warnings
- Ignore `generated/` and `__snapshots__/` directories
- Security findings in `scripts/` are low priority, it's internal tooling
- Be lenient on style, strict on security
```

### Review Styles

| Style | Behavior |
|-------|----------|
| **Strict** | Flags all potential issues, prioritizes quality and security |
| **Balanced** | Focuses on confidence, balances thoroughness with practicality |
| **Lenient** | Only critical bugs and security issues, encouraging tone |
| **Roast** | Technically accurate feedback wrapped in sharp, witty commentary |
| **Thorough** | Structured reasoning (intent → components → execution paths → invariants → edge cases → blast radius) before producing findings |

### Judge / Filter Pass

By default every finding the LLM produces gets posted directly. The judge pass adds a self-reflection stage: after generating findings, a second agent scores each one for confidence (0–10) and drops anything below a configurable threshold. This catches hallucinated findings, speculative claims, and low-value noise before they reach developers.

Enable it with:

```bash
RUSTY_JUDGE_ENABLED=true
RUSTY_JUDGE_THRESHOLD=6          # 0–10, findings below this are dropped
RUSTY_JUDGE_MODEL=anthropic/claude-3-5-haiku-20241022  # optional, cheaper model
```

**How it works:**

1. The reviewer generates findings as normal
2. The judge agent receives the diff + all findings and scores each one 0–10
3. Findings below the threshold are filtered out and logged at `debug` level
4. The merge recommendation is recalculated based on surviving findings
5. The summary footer shows token usage for review and judge separately, plus how many findings were filtered

**Tuning the threshold:**

| Threshold | Behavior |
|-----------|----------|
| 3–4 | Permissive — only drops clearly hallucinated findings |
| 5–6 | Balanced — removes speculative and low-confidence noise |
| 7–8 | Strict — only high-confidence, evidence-backed findings survive |
| 9–10 | Very strict — likely over-filters, use for low-noise environments |

**Cost:** The judge uses a single LLM call with structured output (no tools). Using a cheap model like Haiku adds ~1–3% to total cost. Using the same model as the reviewer adds ~30–50%.

When the judge is disabled (default), the pipeline behaves exactly as before with zero overhead.


### Consensus Voting

By default, each review runs 3 independent passes with shuffled diff ordering (file and hunk order randomized per pass). Findings are clustered across passes using file match, line proximity (±5 lines), and message similarity (Jaccard ≥ 0.3). Only findings that appear in a majority of passes survive — the rest are dropped as likely false positives.

Configure via per-repo config:

```json
{
  "consensusPasses": 5,
  "consensusThreshold": 3
}
```

| Setting | Description | Default |
|---------|-------------|---------|
| `consensusPasses` | Number of independent review passes (1 = disabled) | `3` |
| `consensusThreshold` | Minimum votes to keep a finding (`null` = simple majority) | `ceil(passes/2)` |

**How it works:**

1. The diff is shuffled N times (seeded PRNG for reproducibility) to produce N different orderings
2. Each ordering is reviewed independently in parallel
3. Findings from all passes are clustered by file + line proximity + message similarity
4. Clusters with votes below the threshold are dropped
5. Surviving findings include a `voteCount` showing how many passes flagged them

**Cost:** With the default 3 passes, LLM cost per review triples. Combine with the judge pass (using a cheaper model) to offset costs.

Set `consensusPasses` to `1` to disable consensus voting and get the original single-pass behavior with zero overhead.



### Cascading Review (Triage)

By default every file gets the same deep review treatment. When cascading is enabled, a cheap triage model first classifies each file as `skip`, `skim`, or `deep-review`. Each tier then gets an appropriate level of scrutiny:

| Tier | What happens |
|------|-------------|
| **skip** | File is excluded entirely (lock files, auto-generated code, vendored deps) |
| **skim** | Lightweight single-pass review — diff-only context, no tools, simplified output schema (no `suggestedFix`, no ticket compliance) |
| **deep-review** | Full review pipeline — tree-sitter context expansion, code search tools, consensus voting, ticket compliance |

Enable by setting a triage model:

```bash
RUSTY_LLM_TRIAGE_MODEL=anthropic/claude-3-5-haiku-20241022
```

Or toggle explicitly:

```bash
RUSTY_CASCADE_ENABLED=true   # force on (requires RUSTY_LLM_TRIAGE_MODEL)
RUSTY_CASCADE_ENABLED=false  # force off even if triage model is set
```

**How it works:**

1. The triage agent receives a truncated version of each file's diff (≤200 tokens per file, 30k token budget total) and classifies it
2. Files that overflow the triage budget default to `deep-review`
3. Files the triage model misses also default to `deep-review`
4. Safety net: if triage classifies *all* files as `skip`, the top 20% by additions are force-promoted to `deep-review`
5. Skim-tier and deep-tier files are reviewed in parallel via `runCascadeReview`
6. Results from both tiers are merged, then passed through the judge (if enabled)
7. If triage fails entirely, the bot falls back to the standard full-review pipeline

**Summary comment:** When cascading is active, the PR comment includes a collapsible **Triage Summary** showing how many files were skipped, skimmed, and deep-reviewed, plus the triage model and token usage.

**Dashboard:** The reviews table shows a triage column with the breakdown (e.g. `3s / 5k / 8d` for 3 skipped, 5 skimmed, 8 deep-reviewed).

**Cost:** The triage call itself is cheap (truncated diffs, small output schema). The savings come from skipping context expansion and tool calls for skim-tier files. For a typical PR where ~40% of files are config/docs/tests, expect roughly 30–50% token reduction on the review calls.

### Tree-sitter Context Expansion

By default, when the LLM reviews a diff hunk, the surrounding context is expanded to the enclosing function, method, or class boundary using [tree-sitter](https://tree-sitter.github.io/tree-sitter/) AST parsing. This means the model sees complete semantic units — full functions instead of fragments cut mid-logic — which improves review accuracy and eliminates wasted tokens on unrelated adjacent code.

**Supported languages:** TypeScript, TSX, JavaScript, Python, Go, Java, Rust

**How it works:**

1. Each changed file is parsed with a WASM-based tree-sitter grammar (no native compilation needed)
2. For each changed line range, the smallest enclosing scope (function, method, class) is found in the AST
3. The hunk expands to include the full enclosing scope
4. Collapsed signatures of sibling functions/methods are prepended for orientation (e.g. `// ... export function otherFn()`)
5. If the enclosing scope exceeds 200 lines, or if the language is unsupported, it falls back to the previous ±10 fixed-line expansion

The feature is automatic and requires no configuration. Unsupported languages (CSS, JSON, YAML, etc.) gracefully fall back to fixed-line expansion with zero overhead.

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

# run tests (325 tests)
pnpm test

# start dev server
pnpm --filter @rusty-bot/github start

# start dashboard dev server (with hot reload)
pnpm --filter @rusty-bot/dashboard dev
```

## Claude Code skills

This repo publishes agent skills under `skills/`. They're indexed by [skills.sh](https://skills.sh) and installable with the `skills` CLI:

```bash
# install every skill in this repo
npx skills add jegork/ai-review

# or just one
npx skills add jegork/ai-review/pr-comment-monitor
```

Available skills:

- **pr-comment-monitor** — detects the remote git provider (GitHub / Azure DevOps / GitLab / Bitbucket), finds the current branch's open PR, handles each new review comment (code edit + push, or reply) and resolves the thread. Runs as a one-shot sweep, as an iterative live-watch loop, or on a schedule via the built-in `loop` skill.

## License

MIT
