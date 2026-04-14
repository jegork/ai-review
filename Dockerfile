FROM node:22-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/github/package.json ./packages/github/
COPY packages/azure-devops/package.json ./packages/azure-devops/
COPY packages/dashboard/package.json ./packages/dashboard/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm -r build


FROM node:22-slim AS runtime

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/github/package.json ./packages/github/
COPY packages/azure-devops/package.json ./packages/azure-devops/
COPY packages/dashboard/package.json ./packages/dashboard/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/github/dist ./packages/github/dist
COPY --from=build /app/packages/azure-devops/dist ./packages/azure-devops/dist
COPY --from=build /app/packages/dashboard/dist ./packages/dashboard/dist

# copy prompt files that are bundled alongside dist
COPY --from=build /app/packages/core/src/prompts ./packages/core/dist/prompts

RUN mkdir -p /app/data

VOLUME /app/data

ENV PORT=3000
ENV RUSTY_DB_URL=file:/app/data/rusty.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

COPY <<'EOF' /app/entrypoint.sh
#!/bin/sh
set -e
if [ "$RUSTY_MODE" = "pipeline" ]; then
  exec node /app/packages/azure-devops/dist/index.js
else
  exec node /app/packages/github/dist/server.js
fi
EOF

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
