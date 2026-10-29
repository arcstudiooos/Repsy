# Runbook

No credential appears in this file. Every secret is supplied through your local environment or the Render dashboard.

## Local setup

Prerequisites: Node 24 (`.nvmrc`), pnpm, Docker (for the dev database).

```sh
pnpm install
cp .env.example .env            # placeholders only; fill in locally
pnpm db:up                      # Postgres 16 on localhost:54320
pnpm --filter @kinetic/db exec prisma migrate deploy
SEED_PASSWORD='<at least 12 chars>' pnpm db:seed
```

- `pnpm db:seed` is idempotent and synthetic: `admin@example.test`, `coach@example.test` (with an organization) and three demo client users. All share `SEED_PASSWORD`. It refuses to run without it, and in production.
- The seed prints a pilot code once (only the hash is stored). Mint another any time:
  `pnpm --filter @kinetic/db pilot-code:create -- --expires-days 30` (default 30).
- Sign-up accepts the code in any case, with or without hyphens or spaces.
- Leave `DATABASE_URL` unset in the shell that runs `pnpm test` to use a throwaway embedded Postgres, or point it at the Docker database.
- Local dev connects as the Docker superuser; the runtime role guard is skipped unless `NODE_ENV=production` or `ENFORCE_RUNTIME_ROLE=true`.

Checks before every PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.

## Database roles

| Role | Used for | Variable |
|---|---|---|
| Owner | `prisma migrate deploy`, `pgboss:migrate`, seed, pilot codes, `app-role.sql` | `MIGRATION_DATABASE_URL` |
| `kinetic_app` | web and worker at runtime | `DATABASE_URL` |

`kinetic_app` is LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, and owns nothing. Create or rotate it as the owner:

```sh
PGOPTIONS="-c kinetic.app_password=$KINETIC_APP_PASSWORD" \
  psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/app-role.sql
```

The script is idempotent: re-running it rotates the password and re-grants on current tables. Future tables created by the owner are covered by default privileges. It also creates the empty `pgboss` schema so its default privileges exist before pg-boss installs.

pg-boss: run `pnpm --filter @kinetic/worker pgboss:migrate` with `MIGRATION_DATABASE_URL` set. It installs or upgrades the `pgboss` schema and creates every job queue. In production (and with `ENFORCE_RUNTIME_ROLE=true`) the worker starts pg-boss with `migrate: false, createSchema: false`, so the runtime role needs no DDL rights. After adding a job, re-run `pgboss:migrate` before deploying the worker.

## Deploy to Render: PENDING account setup

Deployment is deferred (the founder will add it later). `render.yaml` is written and unit-tested but has never been applied. When ready:

1. Create the Render account and connect the GitHub repository.
2. **New > Blueprint**, select `render.yaml`. It creates `web`, `worker`, the `kinetic-db` Postgres and the `kinetic-shared` env group.
3. Fill the `sync: false` values in the dashboard: `DATABASE_URL` (set in step 5), `BETTER_AUTH_SECRET`, `ORG_COOKIE_SECRET`, `BETTER_AUTH_URL`, `APP_BASE_URL` (the real service URL; never a hardcoded domain), `EMAIL_FROM`, `RESEND_API_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `ANALYTICS_HASH_SECRET`. Generate secrets with a password manager or `openssl rand -hex 32`.
4. The first deploy runs `preDeployCommand` as the owner (`MIGRATION_DATABASE_URL` is wired from the database): `prisma migrate deploy`, then `pgboss:migrate`. Until step 5 is done the services cannot boot in production; that is expected.
5. As the owner, run `app-role.sql` (command above, against the database's external connection string; allow your IP in the database access list). **Confirm Render allows creating the role; if it does not, stop and escalate.** Then set `DATABASE_URL` in `kinetic-shared` to the `kinetic_app` connection string and redeploy both services.
6. **Verify role refusal**: temporarily set `DATABASE_URL` to the owner string and redeploy `web`; boot must fail with `Unsafe database role`. Restore the `kinetic_app` string.
7. Run the **Smoke (staging)** workflow with the web URL (`.github/workflows/smoke.yml`). Optional repository secrets `SMOKE_EMAIL` / `SMOKE_PASSWORD` enable the sign-in check. Expected: `/healthz` 200 and the login page renders. A Render background worker has no public URL; check it through its logs (`worker started`).
8. The seed is for demo data only and refuses to run with `NODE_ENV=production`. Mint the first real pilot code with `pilot-code:create` from a trusted machine with `MIGRATION_DATABASE_URL` set to the external owner string.

Note: Render exposes service environment variables at runtime, so the owner string on `web` is readable by the web process. It is only used by `preDeployCommand`; the app itself connects through `DATABASE_URL`.

## Rollback

- **Application**: Render dashboard > service > Events > roll back to the previous deploy. Redeploys re-run `preDeployCommand`, which is a no-op when no migration is pending.
- **Migrations are forward-only.** Never edit an applied migration. To undo a schema change, ship a new migration, and keep each release compatible with the previous schema for one deploy (expand, then contract).
- **Secrets**: rotate by changing the dashboard value and redeploying. Rotate the runtime password by re-running `app-role.sql` with the new password, then updating `DATABASE_URL`.

## Backups and restore: placeholder

To be completed once the database exists:

- Backup schedule and retention: backups expire within 35 days (D-010).
- Restore drill: restore into a scratch database, run `assertRuntimeRole` against it, run the smoke spec.
- Record the owner of this procedure and the date of the last successful restore drill here.
