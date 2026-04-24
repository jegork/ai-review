---
title: Ticket integration
description: Link Jira, Linear, GitHub Issues, or ADO work items to PRs for requirements-compliance checks.
---

When linked tickets are found and the corresponding provider is configured, Rusty Bot fetches the ticket content and checks whether the PR implements what the ticket describes. The compliance assessment is included in the review summary.

## Discovery mechanisms

Rusty Bot discovers linked tickets through three mechanisms:

1. **Regex extraction** — scans PR descriptions and branch names for ticket patterns:
   - GitHub Issues: `#123`, `owner/repo#123`, full URL
   - Jira: `PROJ-123`, Jira browse URL
   - Linear: Linear issue URL
   - Azure DevOps: `AB#123`, ADO work item URL
   - Branch names: `feature/123-desc`, `fix/PROJ-123-title`

2. **GitHub linked issues** — queries the `closingIssuesReferences` GraphQL field to find issues linked via closing keywords (`Closes #123`, `Fixes #456`) or the PR Development sidebar.

3. **Azure DevOps linked work items** — calls the PR work items API endpoint to find work items formally linked through the ADO UI, even when not mentioned in the description or branch name.

All three sources are merged and deduplicated before resolution.

## Configuration

| Provider | Required variables |
| --- | --- |
| Jira | `RUSTY_JIRA_BASE_URL` + `RUSTY_JIRA_EMAIL` + `RUSTY_JIRA_API_TOKEN` (or `jira-api-token` action input) |
| Linear | `RUSTY_LINEAR_API_KEY` (or `linear-api-key` action input) |
| GitHub Issues | No config needed — uses `GITHUB_TOKEN` |
| ADO work items | No config needed — uses `SYSTEM_ACCESSTOKEN` |

## Output

When tickets are found and the provider is configured, the review summary includes a compliance assessment — whether the PR addresses what the ticket describes, with any gaps or mismatches called out as findings.
