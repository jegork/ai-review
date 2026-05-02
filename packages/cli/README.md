# @rusty-bot/cli

Local terminal-based runner for the [rusty-bot](../../README.md) review pipeline. Runs the same review engine, prompts, triage cascade, MCP wiring, convention-file loading, and judge pass as the GitHub / Azure DevOps harnesses, but against a local git repo with no PR-mutation side effects.

Findings are printed to stdout as a markdown summary (with collapsible inline findings) or JSON.

## Install

```bash
pnpm install
pnpm -r build
```

The package exposes a `rusty-bot` bin via the workspace. Run it through `pnpm --filter` or after linking globally.

## Usage

```bash
# review the diff between main and HEAD in the current repo
pnpm --filter @rusty-bot/cli start -- --base main --head HEAD

# review a specific repo and ref pair, output JSON, fail on critical findings
rusty-bot \
  --repo /path/to/repo \
  --base origin/main \
  --head feature-branch \
  --style strict \
  --focus security,bugs \
  --format json \
  --fail-on-critical
```

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--repo <path>` | path to the git repo | cwd |
| `--base <ref>` | base ref to diff against | `main` |
| `--head <ref>` | head ref to review | `HEAD` |
| `--style <style>` | `strict` \| `balanced` \| `lenient` \| `roast` \| `thorough` | `balanced` |
| `--focus <list>` | comma-separated focus areas (`security,performance,bugs,style,tests,docs`) | all |
| `--ignore <list>` | comma-separated glob patterns to skip | — |
| `--format <fmt>` | `markdown` or `json` | `markdown` |
| `--fail-on-critical` | exit non-zero when any critical finding is present | off |
| `-h`, `--help` | show help | — |

## Environment

The CLI reads the same environment as the other harnesses. The minimum required to run a review is an LLM model + matching API key:

```bash
export RUSTY_LLM_MODEL=anthropic/claude-sonnet-4-20250514
export ANTHROPIC_API_KEY=sk-ant-...
```

Other supported env vars (see the [root README](../../README.md#configuration) for full descriptions): `RUSTY_REVIEW_STYLE`, `RUSTY_FOCUS_AREAS`, `RUSTY_IGNORE_PATTERNS`, `RUSTY_LLM_TRIAGE_MODEL`, `RUSTY_CASCADE_ENABLED`, `RUSTY_JUDGE_ENABLED`, `RUSTY_JUDGE_THRESHOLD`, `RUSTY_JUDGE_MODEL`, `RUSTY_OPENGREP_RULES`, `RUSTY_LLM_BASE_URL`, `RUSTY_LLM_API_KEY`, MCP server configs.

CLI flags take precedence over the matching env vars.

## Behavior notes

- **`LocalGitProvider`** implements the shared `GitProvider` interface on top of `git` and the working tree. `getDiff`, `getFileContent`, and `getPRMetadata` are real; comment / title / description mutation methods are no-ops.
- **`searchCode`** shells out to `ripgrep` when it is on `PATH` (preferred — fast and gitignore-aware) and falls back to `git grep` otherwise. Returns the same `{ file, line, content }` rows that the LLM tool-call sees in the GitHub harness.
- **Cascade / triage** runs when `RUSTY_CASCADE_ENABLED=true` (or auto when `RUSTY_LLM_TRIAGE_MODEL` is set), with `triageStats` decorated on the result.
- **Convention files** (`.rusty-bot.md`, `REVIEW-BOT.md`, `AGENTS.md`) are loaded from the **target** ref of the diff, matching the GitHub/Azure DevOps behavior.
- **Exit codes:** `0` on success, `1` when `--fail-on-critical` is set and a critical finding is present, `2` on argument parse errors or fatal runtime errors.

## Development

```bash
pnpm --filter @rusty-bot/cli build
pnpm --filter @rusty-bot/cli test
```
