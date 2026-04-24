---
title: Convention files
description: Check in a .rusty-bot.md to inject repo-specific review rules into the system prompt.
---

Add a markdown file to your repo root and Rusty Bot will inject its content into the system prompt on every review. This is the primary way to encode stack conventions, severity guidance, and domain terminology without touching any configuration UI.

## Priority

When multiple files are present, the first match wins:

| File | Priority |
| --- | --- |
| `.rusty-bot.md` | Highest |
| `REVIEW-BOT.md` | Medium |
| `AGENTS.md` | Lowest |

## Security

:::caution
The convention file is fetched from the **target branch** of the PR, not from the PR branch. PR authors cannot tamper with review rules by modifying the file in their own branch.
:::

## What to put in it

```markdown
- We use Effect-TS, don't flag `.pipe()` chains as complexity issues
- All API endpoints must have Zod validation — flag missing schemas as warnings
- Ignore `generated/` and `__snapshots__/` directories
- Security findings in `scripts/` are low priority, it's internal tooling
- Be lenient on style, strict on security
```

Good candidates: stack conventions, directories to ignore, severity guidance (e.g. "treat missing tests as warnings, not errors"), domain terminology the LLM might misinterpret.

Do not put secrets or sensitive configuration in this file — it is a plaintext file checked into the repo and visible to anyone with read access.
