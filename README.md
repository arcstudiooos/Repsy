# Kinetic

Coaching web app. pnpm monorepo.

- `apps/web` - Next.js (App Router) web app
- `apps/worker` - background worker
- `packages/core` - domain logic (no provider SDKs)
- `packages/db` - database schema and access

## Local development

Prerequisites: Node 24 (`nvm use`), pnpm (`corepack enable`), Docker Desktop.

```sh
pnpm install
pnpm db:up                 # Postgres 16 on localhost:54320 (waits until healthy)
cp .env.example .env       # repo root; works as-is with no provider keys
# edit .env: set SEED_PASSWORD to any local value of 12+ characters
pnpm db:migrate            # prisma migrate deploy against DATABASE_URL
pnpm db:seed               # demo users + prints a pilot code once
pnpm dev                   # web (http://localhost:3000) + worker together
```

Open http://localhost:3000 and sign in as `coach@example.test` (or `admin@example.test`) with your `SEED_PASSWORD`, or sign up with the printed pilot code.

- With provider keys blank: emails go to the dev sink, Google sign-in is hidden, Sentry and PostHog are off.
- Verification and reset emails land as JSON files in `DEV_EMAIL_DIR` (blank = `.dev-emails/` at the repo root), also listed at http://localhost:3000/api/dev/emails. Open the link in the `text` field.
- `pnpm dev`, `pnpm db:migrate`, `pnpm db:seed`, `pilot-code:create` and `pgboss:migrate` read the root `.env` (Node's built-in env-file loader; variables already set in the shell win). `pnpm test` does not.
- `pnpm db:down` stops the container (data persists in a named volume).

## What works locally (Sprint 1)

- Sign up with a pilot code, verify email, create your coaching organization.
- Exercise library, and a program builder with explicit save (weeks, training days, exercises, sets).
- Clients: add, invite by email (send, resend, revoke), the client accepts and lands in the portal.
- Assign a saved program to an active client from the client's Program tab or the Programs list: pick a start date (default today in the client's time zone), the training days, and confirm readiness on a first assignment. Workouts are scheduled in the client's time zone.
- Replacing an active program asks for confirmation and applies only to upcoming workouts.
- The Program tab shows the current program, start date, training days, session count and the next session.

## Tests

`pnpm test` starts a throwaway embedded Postgres when `DATABASE_URL` is unset in the shell. To use the Docker database instead: `DATABASE_URL=postgresql://kinetic:kinetic@localhost:54320/kinetic pnpm test`.

## Scripts

- `pnpm lint` - ESLint across the repo
- `pnpm typecheck` - TypeScript in every workspace
- `pnpm dev` - web + worker for local development
- `pnpm test` - Vitest unit and integration tests
- `pnpm test:e2e` - Playwright end-to-end tests (web app)
- `pnpm db:up` / `pnpm db:down` - start or stop local Postgres
- `pnpm db:migrate` / `pnpm db:seed` - apply migrations / seed demo data (read the root `.env`)
- `pnpm format` - Prettier (writes; prefer formatting only files you changed)
- `pnpm format:check` - Prettier check on source dirs (CI)

Per-app scripts are documented in `apps/web/README.md`.
