---
title: OpenGrep pre-scan
description: Run deterministic SAST on changed files before the LLM review to catch secrets, SQLi, and XSS.
---

Rusty Bot can run [OpenGrep](https://opengrep.dev/) (LGPL-2.1 fork of Semgrep) on changed files before the LLM review. OpenGrep findings are fed to the LLM as structured context so the model can confirm true positives or dismiss false positives with an explanation. This combines deterministic SAST coverage with LLM-powered triage — catching patterns LLMs detect inconsistently (hardcoded secrets, SQL injection, XSS) while filtering false positive noise.

## Requirements

`opengrep` must be available in `PATH`. The Docker image used by the GitHub Action and Azure Pipelines includes it by default. If it's not installed, the review continues LLM-only with a logged notice — no action required.

## Installation (outside Docker)

```bash
curl -fsSL https://raw.githubusercontent.com/opengrep/opengrep/main/install.sh | bash
```

## Configuration

```bash
# use curated ruleset (default)
RUSTY_OPENGREP_RULES=auto

# use a custom config file from the repo
RUSTY_OPENGREP_RULES=.semgrep.yml

# use a specific registry ruleset
RUSTY_OPENGREP_RULES=p/security-audit
```

## How it works

1. Changed file paths (excluding binaries) are written to a temp file
2. `opengrep scan --config <rules> --json --quiet --target-list <file>` runs with a 2-minute timeout
3. JSON output is parsed into structured findings (rule ID, file, line range, message, severity, snippet)
4. Findings are injected into the LLM user prompt before the diff, with instructions to confirm or dismiss each one
5. When the diff is split into token-aware chunks, OpenGrep findings are filtered to only the files in each chunk

The PR summary comment includes an OpenGrep stats line showing finding count, availability, and any errors.

## Cost

OpenGrep runs locally in seconds with zero LLM cost. The only added token cost is the findings injected into the prompt — roughly 50–200 tokens per finding.
