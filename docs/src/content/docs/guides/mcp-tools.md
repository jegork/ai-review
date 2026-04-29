---
title: MCP tools
description: Give the review and triage agents extra tools via Model Context Protocol servers — fetch docs, query Sentry, look up tickets, anything an MCP server can expose.
---

Rusty Bot can connect to one or more [Model Context Protocol](https://modelcontextprotocol.io/) servers at startup and surface their tools to the review and triage agents. The agents can then call those tools mid-review — to fetch upstream documentation, query an error tracker, look up a related ticket, or anything else an MCP server exposes.

## Why this matters

The default review only sees the diff, the surrounding tree-sitter context, the OpenGrep findings, and (optionally) ticket descriptions. MCP tools widen that view *on demand*: the model decides when it needs to call out, so you don't pay the cost of pulling extra context into every review.

Typical use cases:

- **Internal docs** — point to an MCP docs server so the model can verify a finding against your library's actual API instead of hallucinating.
- **Observability** — connect a Sentry / Grafana MCP so the model can check whether a code path that "looks fine" is actually the source of recent production errors.
- **Ticket trackers beyond the built-ins** — Rusty Bot has first-class Linear / Jira / GitHub / Azure DevOps integration, but MCP lets you wire up anything else (Notion, ClickUp, custom internal tools).

## Configuration

Drop a `mcp-servers.json` next to your repo (or anywhere accessible to the action / server) and point Rusty Bot at it with `RUSTY_MCP_CONFIG`:

```bash
RUSTY_MCP_CONFIG=./mcp-servers.json
```

When `RUSTY_MCP_CONFIG` is unset, Rusty Bot looks for `./mcp-servers.json` in the current working directory. If that file doesn't exist either, MCP is silently disabled.

## File format

A JSON object keyed by server name. Each server is either a **stdio** transport (a local process Rusty Bot spawns) or an **HTTP/SSE** transport (a remote server):

```json
{
  "docs": {
    "command": "npx",
    "args": ["-y", "@my-org/mcp-docs-server"],
    "env": {
      "DOCS_API_TOKEN": "<replace-with-real-token-or-templated-by-your-secrets-manager>"
    }
  },
  "sentry": {
    "url": "https://mcp.sentry.io/sse",
    "requestInit": {
      "headers": {
        "Authorization": "Bearer <replace-with-real-token>"
      }
    }
  }
}
```

:::caution[No `${VAR}` interpolation — render real secrets in, don't commit them]
String values in `mcp-servers.json` are passed through **verbatim**. Rusty Bot does *not* expand `${VAR}`, `$VAR`, or any other shell syntax — `"FOO": "${MY_TOKEN}"` reaches the spawned process as the literal four-character string `${MY_TOKEN}`, not the value of `$MY_TOKEN`.

For stdio servers, the spawned process also does *not* automatically inherit arbitrary env vars from Rusty Bot's environment. The underlying MCP SDK only forwards a small safe list (`HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM`, `USER` on Unix; the equivalent system vars on Windows). Anything else — including any secret you've already exported in your shell or set on the action runner — must be listed explicitly in the `env` block to reach the server.

So real secrets *do* end up in this file. The right move is to:

1. **Render `mcp-servers.json` at startup from your secrets manager / deployment platform** (Kubernetes secrets, GitHub Actions secrets, Azure Key Vault, …) so the rendered file with real values exists only on the running container / runner, never in git.
2. **Add `mcp-servers.json` to `.gitignore`** alongside any template you check in (e.g. `mcp-servers.example.json`).
:::

| Field (stdio) | Required | Description |
| --- | --- | --- |
| `command` | yes | Executable to spawn (e.g. `npx`, `python`, `node`, an absolute path) |
| `args` | no | Arguments passed to the command |
| `env` | no | Extra env vars set on the spawned process (literal string values; no shell interpolation) |

| Field (HTTP) | Required | Description |
| --- | --- | --- |
| `url` | yes | HTTP/SSE endpoint of the remote MCP server |
| `requestInit` | no | Extra fetch options — `headers` is the most common use |

## How tools reach the agents

On startup, Rusty Bot:

1. Loads the config from `RUSTY_MCP_CONFIG` (or `./mcp-servers.json`).
2. Connects to each server independently. **A failure on one server is logged and skipped — the rest still contribute their tools.**
3. Calls `listTools()` on each connected server and merges the results into the tool set passed to the review and triage agents.
4. Disconnects all servers when the review finishes (including on error).

The merged tool set is also visible to the cascade-triage agent, so a triage model can call out to MCP tools when classifying files.

## Failure modes

- **Invalid JSON** in `mcp-servers.json` → fatal at startup, with the file path in the error message.
- **Schema violations** (entry without `command` *and* without `url`, non-object entry, etc.) → fatal, with a per-field list of issues.
- **Server fails to start or list tools** → warning logged (`failed to connect MCP server; skipping`) and the rest of the review proceeds without that server's tools.
- **Tool call fails mid-review** → handled like any other tool error; the agent decides whether to retry or work around it.

## Performance notes

- Stdio servers add startup latency on every review (the process is spawned fresh). Prefer HTTP for hot-loop servers.
- Tool calls are billed against your model provider's tokens, not just MCP — every tool result the model reads is input tokens on the next turn.
- The cascade-triage agent typically does *not* call tools (it's optimized for cheap classification), but it can. If you don't want that, point only the review agent at MCP-heavy servers and keep the triage model lean.

## Related

- [Cascading review](/guides/cascading-review/) — controls which files the deep-review (and therefore MCP-using) agent sees
- [Ticket integration](/guides/ticket-integration/) — built-in alternative for Linear / Jira / GitHub / ADO without writing an MCP server
- [`RUSTY_MCP_CONFIG`](/reference/env-vars/#mcp-tools) — env var reference
