# Kinetic

Coaching web app. pnpm monorepo.

- `apps/web` - Next.js (App Router) web app
- `apps/worker` - background worker
- `packages/core` - domain logic (no provider SDKs)
- `packages/db` - database schema and access

## Setup

```sh
nvm use          # Node 24
corepack enable
pnpm install
cp .env.example .env
```

## Scripts

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`
