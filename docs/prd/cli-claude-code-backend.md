# PRD: Claude Code backend for `@rusty-bot/cli`

**Status:** draft
**Owner:** TBD
**Related:** `packages/cli` (added in this branch)

## 1. Problem

The new `@rusty-bot/cli` lets developers run rusty-bot reviews against a local
git diff. Today it requires an API key (`ANTHROPIC_API_KEY` or another
provider's key) configured via env. That's friction for the primary CLI
audience: developers who already have Claude Code installed and a Pro/Max
subscription, and who would prefer not to manage a separate API key (or pay
twice) just to run a review locally.

We want the CLI to optionally use a locally-installed, logged-in Claude Code
as its LLM backend, so a `claude login`'d user can run `rusty-bot` with no
additional setup.

## 2. Goals

- A CLI invocation works end-to-end with **no `ANTHROPIC_API_KEY`** when the
  user has Claude Code installed and authenticated.
- Output quality is comparable to the existing API-key path on a single
  review (consensus / cascade are stretch goals — see §7).
- The integration is **CLI-only**. The webhook server, GitHub Action, and
  Azure DevOps task continue to use API-key auth.
- The implementation introduces a clean `LlmBackend` seam in `core` so future
  backends (Ollama, vLLM, OpenAI-compatible endpoints) can slot in without
  another rewrite.

## 3. Non-goals

- Replacing Mastra wholesale. The API-key path keeps using `@mastra/core`
  and the existing `runReview` pipeline.
- Bundling or shipping Claude Code itself — we depend on it being on `$PATH`.
- Subscription-auth use in CI, the Action, the ADO task, or the webhook
  server (see §6 for the licensing rationale).

## 4. Users & use cases

| User | Use case | Acceptance |
|---|---|---|
| Developer with Claude Code subscription | `rusty-bot --base main` before pushing | Works without `ANTHROPIC_API_KEY` |
| Developer without subscription, with API key | Same flow, API-key path | Unchanged from today |
| CI / Action / ADO operator | Server-side review | Unchanged — stays on API-key path; subscription auth not offered |

## 5. Proposed solution

### 5.1 Backend selection

Add `--llm-backend` to the CLI with three values:

- `auto` (default) — prefer `claude-code` if `ANTHROPIC_API_KEY` is unset and
  `claude` is on `$PATH`; else use `api`.
- `claude-code` — force Claude Code transport; error if unavailable.
- `api` — force the existing Mastra + API-key path.

Equivalent env: `RUSTY_LLM_BACKEND`.

### 5.2 Core seam: `LlmBackend`

Introduce an interface in `@rusty-bot/core` that the existing review pipeline
goes through:

```ts
interface LlmBackend {
  generateStructured<T>(opts: {
    schema: ZodSchema<T>;
    system: string;
    user: string;
    tools?: Tool[];
    maxTurns?: number;
    modelHint?: string;
  }): Promise<{ data: T; tokenCount: number; modelUsed: string }>;
}
```

Phase 1: extract the Mastra agent calls inside `runReview`,
`runConsensusReview`, `runTriage`, `runJudge`, `generatePRDescription`,
`generateConventionalTitle` behind this interface. **Behavior unchanged.** This
is the bulk of the refactor.

Phase 2: add a second implementation, `ClaudeCodeBackend`, in
`packages/cli` (kept out of `core` to keep core a pure library and to scope
the SDK dependency).

### 5.3 `ClaudeCodeBackend` design

Use `@anthropic-ai/claude-agent-sdk` (not the CLI binary directly):

- Tool-loop semantics differ from Mastra's structured-output stop. Strategy:
  define a terminal tool `submit_review` whose input schema is the Zod schema
  of the expected output (e.g. `ReviewOutputSchema`). The model is instructed
  to call `submit_review` exactly once. The backend resolves on that tool
  call, validates with Zod, and returns. A `maxTurns` cap (default 8)
  prevents runaway loops.
- Custom tools (`search-code`, `get-file-context`) are registered as
  in-process SDK tools, mapping 1:1 to the existing `GitProvider` methods.
- MCP servers loaded from env are forwarded to the SDK's MCP wiring instead
  of `@mastra/mcp`.
- Auth: rely on the SDK's default behavior — when no `ANTHROPIC_API_KEY` is
  present, it spawns the local `claude` to inherit OAuth credentials.

### 5.4 CLI changes

- `parseArgs` learns `--llm-backend`.
- The CLI constructs the backend once and passes it into `runMultiCallReview`
  / `runCascadeReview` (which in turn forward it through the new options
  param introduced in Phase 1).
- `--help` documents the auth requirements for each backend.

## 6. Auth & licensing

This is the riskiest part of the proposal.

- Anthropic's subscription plans (Claude Pro / Max) license **personal,
  interactive use of Claude Code**. Local one-shot reviews launched by the
  developer fit comfortably inside that envelope.
- Automated server-side use (CI, webhook handlers, scheduled jobs) is
  outside that envelope. Even though the SDK can technically authenticate
  via subscription tokens, doing so in CI is likely a ToS violation.

**Decisions encoded in the design:**

1. Subscription auth is offered only via the CLI package; the
   github-action, azure-devops, and github webhook server packages will not
   pull in `@anthropic-ai/claude-agent-sdk`.
2. The `--help` text and README explicitly call out the personal-use scope.
3. We do not document a "use this in CI to save money" path.

## 7. Open questions

- **Consensus & judge passes.** Mastra runs N parallel calls; the SDK
  supports concurrent `query()` invocations, but each may be a multi-turn
  agent loop, which is more expensive. Should `claude-code` backend default
  to single-pass review (no consensus)? Probably yes for v1.
- **Triage cascade.** Same question. Triage uses a cheaper model (Haiku) on
  the API path; the SDK's model selection is governed by the user's Claude
  Code config. We may have to drop tier differentiation when the backend
  is `claude-code`.
- **Token accounting.** The SDK reports usage per turn but the shape may
  differ from what `ReviewResult.tokenCount` expects. Need to map.
- **Streaming progress.** The CLI already prints to stdout at the end; do we
  surface intermediate agent events (tool calls, thinking) as the SDK
  emits them? Probably behind a `--verbose` flag.
- **Schema repair.** If `submit_review` is called with invalid params, do we
  send a corrective turn back into the loop, or fail and let the consensus
  layer retry? Probably the latter, simpler.
- **OpenGrep / convention file.** These are agnostic to the backend and
  should keep working unchanged.

## 8. Phasing

**Phase 1 — `LlmBackend` extraction (no user-visible change)**
- Define `LlmBackend` in `core`.
- Implement `MastraBackend` (the current behavior).
- Thread it through `runReview`, `runConsensusReview`, `runTriage`,
  `runJudge`, description / title generators.
- All existing tests pass unchanged.

**Phase 2 — `ClaudeCodeBackend` in CLI**
- Add SDK dependency to `@rusty-bot/cli` only.
- Implement `ClaudeCodeBackend` with the `submit_review` terminal-tool
  pattern.
- Wire the CLI's `--llm-backend` selector.
- Add unit tests for the schema-extraction logic; add an integration test
  guarded behind a `CLAUDE_CODE_AVAILABLE` env that the CI does not set.

**Phase 3 — Polish**
- `--verbose` streaming.
- README/help-text updates with the licensing scope.
- Optional: detect `claude` on PATH and print a one-liner suggesting
  `--llm-backend=claude-code` when no API key is set.

## 9. Success criteria

- A logged-in Claude Code user runs `rusty-bot --base main` in a sample repo
  and gets a review summary on stdout, with no API key configured.
- `pnpm test` passes — including the existing 718 tests, untouched.
- The github-action, azure-devops, and webhook packages do not import the
  Agent SDK (verified by a lint rule or dependency check).
- A side-by-side review of the same diff via `--llm-backend=api` and
  `--llm-backend=claude-code` produces findings of comparable
  severity/category coverage on a hand-picked sample of 5+ PRs. (Subjective;
  agreed by humans, not asserted automatically.)

## 10. Risks

- **Mastra refactor scope creep.** Phase 1 touches every agent file. If we
  underscope it, Phase 2 lands on shaky ground. Mitigate by keeping
  `LlmBackend` minimal and not "improving" anything else in that pass.
- **SDK API churn.** The Agent SDK is newer than the Anthropic SDK. Pin a
  specific version, isolate behind the `LlmBackend` adapter, accept that
  bumping it may need maintenance.
- **Quality regression.** A tool-loop terminating in `submit_review` can
  produce sloppier structured output than native structured outputs. We
  need a Zod validation + single retry loop and visibility (logs) into how
  often it triggers.
- **ToS interpretation drift.** Anthropic's stance on agentic /
  programmatic use of subscription auth could change. Keep the integration
  optional and clearly scoped to interactive local use so we can pull it
  cheaply if needed.
