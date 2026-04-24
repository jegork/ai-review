---
title: Self-hosted GitHub App
description: Run Rusty Bot as a GitHub App webhook server instead of a per-PR Action.
---

The GitHub Action is the easy path. If you'd rather run Rusty Bot as a
long-lived webhook server (single install across many repos, no per-PR
Action minutes), set it up as a GitHub App.

## 1. Create the App

Use the [`github-app-manifest.json`](https://github.com/jegork/rusty-bot/blob/main/github-app-manifest.json)
template, or create a new App at
`https://github.com/settings/apps/new` with these permissions:

- **Pull requests**: Read & Write
- **Issues**: Read
- **Contents**: Read

Subscribe to the **Pull request** event.

## 2. Generate credentials

- Generate a private key (downloads a `.pem`)
- Note the App ID and create a webhook secret

## 3. Configure and run

Copy `.env.example` to `.env`, fill in:

```bash
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=...
ANTHROPIC_API_KEY=...
```

Then start the server:

```bash
pnpm --filter @rusty-bot/github start
# or
podman compose up --build
```

The dashboard is at `/`, health check at `/health`, and webhooks at
`/webhook`.

## 4. Install on repos

Install the App on any repo from the App's public install URL. PRs in those
repos will get reviewed automatically.
