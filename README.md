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

## Local database

Postgres 16 runs in Docker, matching CI. Requires Docker Desktop.

```sh
pnpm db:up                 # start Postgres 16 on localhost:54320 (waits until healthy)
# export DATABASE_URL=postgresql://kinetic:kinetic@localhost:54320/kinetic  (value from .env.example), then:
pnpm test
pnpm db:down               # stop the container (data persists in a named volume)
```

If `DATABASE_URL` is unset, tests start an embedded Postgres automatically instead.

## Scripts

- `pnpm lint` - ESLint across the repo
- `pnpm typecheck` - TypeScript in every workspace
- `pnpm test` - Vitest unit and integration tests
- `pnpm test:e2e` - Playwright end-to-end tests (web app)
- `pnpm db:up` / `pnpm db:down` - start or stop local Postgres
- `pnpm format` - Prettier (writes; prefer formatting only files you changed)

Per-app scripts are documented in `apps/web/README.md`.
