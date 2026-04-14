---
name: pr-comment-monitor
description: Watch an open pull/merge request for new review comments, act on each one, and resolve the thread. Use when the user says things like "watch this PR", "monitor the PR for comments", "wait for review comments and fix them", "keep an eye on the PR", or "poll my PR and resolve comments". Automatically detects whether the remote is GitHub, Azure DevOps, GitLab, or Bitbucket from `git remote`.
---

# PR comment monitoring

Goal: detect the remote git provider for the current repo, locate the open PR for the current branch, then watch for incoming review comments. For each new comment, understand what the reviewer is asking, do the work (edit code / reply / push a commit as appropriate), and resolve the thread before moving on.

## 1. Detect the remote provider

Run `git remote get-url origin` (or the remote the user names) and parse the host:

| Host substring                  | Provider       |
| ------------------------------- | -------------- |
| `github.com`                    | GitHub         |
| `dev.azure.com`, `visualstudio.com` | Azure DevOps |
| `gitlab.com` or self-hosted GitLab | GitLab      |
| `bitbucket.org`                 | Bitbucket Cloud |

If the host doesn't match any of these, ask the user which provider to use. Parse `owner/repo` (GitHub/GitLab/Bitbucket) or `organization/project/repo` (Azure DevOps) from the URL — strip any embedded credentials (e.g. `http://user@host/...`) before parsing.

Record the current branch with `git rev-parse --abbrev-ref HEAD`.

## 2. Find the PR for the current branch

- **GitHub**: prefer the `mcp__github__*` tools when available. Use `mcp__github__list_pull_requests` with `head=<owner>:<branch>` and `state=open` to find the PR. If MCP tools are not available, fall back to `gh pr view --json number,url` or the REST API (`GET /repos/{owner}/{repo}/pulls?head=...&state=open`).
- **Azure DevOps**: `GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/pullrequests?searchCriteria.sourceRefName=refs/heads/{branch}&api-version=7.1` with `Authorization: Basic $(printf ':%s' "$RUSTY_ADO_PAT" | base64)`.
- **GitLab**: `GET {base}/api/v4/projects/{urlencoded-path}/merge_requests?source_branch={branch}&state=opened` with `PRIVATE-TOKEN: $GITLAB_TOKEN`.
- **Bitbucket**: `GET https://api.bitbucket.org/2.0/repositories/{workspace}/{repo}/pullrequests?q=source.branch.name="{branch}"&state=OPEN` with `Authorization: Bearer $BITBUCKET_TOKEN`.

If there's more than one match, confirm with the user. If there is none, stop and tell the user.

## 3. Watch for new comments

Prefer a push-style subscription over polling when it's available:

- **GitHub**: call `mcp__github__subscribe_pr_activity` with the PR number. Comment/review events then arrive as `<github-webhook-activity>` messages — no polling needed. Handle each event as it arrives.
- **Other providers**: poll. Track the last-seen comment id (or `updated_at`) between iterations. Between polls, use `Bash` with `run_in_background: true` to start `sleep 30 && date` (or similar) and then read its output when it finishes — this avoids the 2 s inline-sleep limit and lets the user interrupt. For longer watches, suggest the user invoke this skill via the built-in `loop` skill (e.g. `/loop 2m pr-comment-monitor`) so the harness drives the schedule instead of a sleeping shell.

Endpoints for polling:

- **Azure DevOps**: `GET .../pullRequests/{id}/threads?api-version=7.1` — each thread has `status` (active/closed/fixed), `comments`, and `lastUpdatedDate`.
- **GitLab**: `GET /projects/{id}/merge_requests/{iid}/discussions` — each discussion has `notes[]` and a `resolved` flag.
- **Bitbucket**: `GET .../pullrequests/{id}/comments?q=deleted=false&sort=-updated_on`.

Only act on comments authored by someone other than the bot/user running the skill, and only on ones newer than the last-processed marker. Skip comments that are replies to threads already resolved.

## 4. Handle each comment

For every new unresolved comment thread:

1. Read the comment and the diff/line it targets. For GitHub review comments, the file path and line are in the event payload; for inline Azure DevOps comments they're on the thread's `threadContext`. Load the referenced file at that line before responding.
2. Decide the action:
   - **Code change requested** — make the edit, run the repo's test/lint commands if they're obvious (`pnpm test`, `pnpm lint`, etc.), commit with a message referencing the comment, and push to the PR branch.
   - **Question / clarification** — reply in-thread explaining the code or the decision.
   - **Nit you disagree with** — reply with a short justification and leave the thread for the human to resolve; do not auto-resolve in this case.
   - **Ambiguous** — use `AskUserQuestion` with enough context (the quoted comment, the file, your proposed action) so the user can decide without scrolling.
3. Resolve the thread once the action is done:
   - **GitHub**: `mcp__github__resolve_review_thread` (review comments) or post a reply via `mcp__github__add_reply_to_pull_request_comment` then resolve. Plain issue-style PR comments can't be resolved; just reply.
   - **Azure DevOps**: `PATCH .../threads/{threadId}?api-version=7.1` with `{"status":"fixed"}` (or `closed` if you pushed back).
   - **GitLab**: `PUT /projects/{id}/merge_requests/{iid}/discussions/{discussion_id}?resolved=true`.
   - **Bitbucket**: `POST .../pullrequests/{id}/comments/{comment_id}/resolve`.
4. Update the last-seen marker so the same comment isn't reprocessed on the next iteration.

## 5. Stop conditions

Exit the watch loop when any of these is true:

- The user says to stop, or cancels the session.
- The PR is merged or closed (`state != open`).
- All open threads are resolved and the user asked for a one-shot sweep rather than continuous watching.
- A handler raised an error that needs human attention — surface it and stop rather than looping on the same failure.

Always leave a short summary at the end: how many comments were processed, which were resolved vs. replied-only, and any commits pushed.

## Authentication notes

- GitHub MCP tools in this harness are scoped to `jegork/ai-review`. Outside that repo, fall back to `gh` or a `GITHUB_TOKEN` env var.
- For Azure DevOps use `RUSTY_ADO_PAT` (already documented in this repo's `.env.example`) or `SYSTEM_ACCESSTOKEN` when running in a pipeline.
- Never echo tokens into the terminal output or commit messages.
