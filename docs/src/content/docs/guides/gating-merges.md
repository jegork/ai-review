---
title: Gating merges
description: Block PR merges when critical findings are found.
---

## How it works

Setting `RUSTY_FAIL_ON_CRITICAL=true` causes Rusty Bot to exit with code 1 when any finding at the `critical` severity level is produced. A non-zero exit code fails the CI job, which can be required as a branch protection check — blocking the merge until the critical finding is resolved or dismissed.

## GitHub Actions

Add `RUSTY_FAIL_ON_CRITICAL: "true"` to the step `env:`:

```yaml
- uses: jegork/ai-review@v1
  env:
    RUSTY_FAIL_ON_CRITICAL: "true"
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Then require the job as a status check: **Settings → Branches** (or **Rules**) → add a branch protection rule → enable "Require status checks to pass" and select the Rusty Bot job.

## Azure DevOps

Add `RUSTY_FAIL_ON_CRITICAL: "true"` to the step `env:` in your pipeline YAML (it is already included in the [minimal example](/providers/azure-devops/)).

To enforce it as a merge gate: **Project Settings → Repositories → Policies → Branch policies → Build validation**, then point to the Rusty Bot pipeline.

## What counts as critical

Rusty Bot uses a four-level severity ladder:

| Severity | Description |
| --- | --- |
| `info` | Stylistic suggestions or observations |
| `warning` | Potential issues worth addressing |
| `error` | Likely bugs or significant problems |
| `critical` | High-confidence bugs, security vulnerabilities, or data-loss risks |

Only findings at the `critical` level trigger the non-zero exit. `error` and below are reported but do not block the merge.
