# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities by emailing **jegor.kitskerkin@gmail.com** with the subject line `[rusty-bot] security disclosure`. Include:

- A description of the vulnerability and its impact
- Steps to reproduce or a proof-of-concept
- Affected versions

You should receive an acknowledgement within 48 hours and a resolution timeline within 7 days.

## Scope

Rusty Bot handles sensitive material: GitHub App private keys, webhook secrets, and LLM API keys passed via environment variables. The following are in scope:

- Credential or secret leakage through logs, comments, or API responses
- Authentication or authorisation bypass in the webhook server
- Code execution via maliciously crafted PR payloads
- Privilege escalation through the GitHub App or ADO integration

Theoretical denial-of-service issues and vulnerabilities in third-party dependencies (tracked separately via Dependabot) are out of scope for direct reports.

## Known advisories

- `uuid@8.3.2` (bundled in `@azure/msal-node@5.1.2`) — GHSA-w5hq-g745-h8pq, moderate. Not directly exploitable in this project's usage; tracked for upstream fix.
