# Runbook

No credential appears in this file. Every secret is supplied through your local environment or the Render dashboard.

## Local setup

Prerequisites: Node 24 (`.nvmrc`), pnpm, Docker (for the dev database).

```sh
pnpm install
pnpm db:up                      # Postgres 16 on localhost:54320
cp .env.example .env            # repo root; no provider keys needed
# set SEED_PASSWORD in .env (12+ chars, local only)
pnpm db:migrate                 # prisma migrate deploy (reads .env)
pnpm db:seed
pnpm dev                        # web on http://localhost:3000 + worker
```

- The root `.env` is loaded by `pnpm dev` (web via `process.loadEnvFile` in `next.config.ts`, worker via `node --env-file-if-exists`), `db:migrate`, `db:seed`, `pilot-code:create` and `pgboss:migrate`. Shell variables win over the file. Production processes (`start` scripts) never read it.
- Blank provider keys = local mode: emails are written to `DEV_EMAIL_DIR` (blank = `<repo>/.dev-emails`, also at `/api/dev/emails`), Google sign-in is off, Sentry and PostHog are no-ops.
- `pnpm db:seed` is idempotent and synthetic: `admin@example.test`, `coach@example.test` (with an organization) and three demo client users. All share `SEED_PASSWORD`. It refuses to run without it, and in production.
- The seed prints a pilot code once (only the hash is stored). Mint another any time:
  `pnpm --filter @kinetic/db pilot-code:create -- --expires-days 30` (default 30).
- Sign-up accepts the code in any case, with or without hyphens or spaces.
- Leave `DATABASE_URL` unset in the shell that runs `pnpm test` to use a throwaway embedded Postgres, or point it at the Docker database.
- Local dev connects as the Docker superuser; the runtime role guard is skipped unless `NODE_ENV=production` or `ENFORCE_RUNTIME_ROLE=true`.

Checks before every PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.

## Database roles

| Role          | Used for                                                                     | Variable                 |
| ------------- | ---------------------------------------------------------------------------- | ------------------------ |
| Owner         | `prisma migrate deploy`, `pgboss:migrate`, seed, pilot codes, `app-role.sql` | `MIGRATION_DATABASE_URL` |
| `kinetic_app` | web and worker at runtime                                                    | `DATABASE_URL`           |

`kinetic_app` is LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, and owns nothing. Create or rotate it as the owner. The owner only needs CREATEROLE (no superuser): attributes are set at CREATE time and rotation changes the password only.

Password hygiene (the password travels through PGOPTIONS, and libpq splits `-c` values on spaces, so it must have no spaces or special characters):

```sh
KINETIC_APP_PASSWORD=$(openssl rand -hex 32)       # hex only: no escaping problems
echo "$KINETIC_APP_PASSWORD"                       # copy it into Render's DATABASE_URL now; it is not stored anywhere
read -rs -p "Owner connection string: " MIGRATION_DATABASE_URL; export MIGRATION_DATABASE_URL   # not in shell history
PGOPTIONS="-c kinetic.app_password=$KINETIC_APP_PASSWORD"   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/app-role.sql
unset KINETIC_APP_PASSWORD MIGRATION_DATABASE_URL
```

- `SHOW kinetic.app_password` exposes the value to anyone with that session, so do not leave the session open.
- The script never echoes the password in errors, but **if it errored, rotate** (re-run with a fresh password) before trusting the role.

The script is idempotent: re-running it rotates the password and re-grants on current tables. Future tables created by the owner are covered by default privileges. It also creates the empty `pgboss` schema so its default privileges exist before pg-boss installs.

pg-boss: run `pnpm --filter @kinetic/worker pgboss:migrate` with `MIGRATION_DATABASE_URL` set. It installs or upgrades the `pgboss` schema and creates every job queue. In production (and with `ENFORCE_RUNTIME_ROLE=true`) the worker starts pg-boss with `migrate: false, createSchema: false`, so the runtime role needs no DDL rights. After adding a job, re-run `pgboss:migrate` before deploying the worker.

## Deploy to Render: PENDING account setup

Deployment is deferred (the founder will add it later). `render.yaml` is written and unit-tested but has never been applied. When ready:

1. Create the Render account and connect the GitHub repository.
2. **New > Blueprint**, select `render.yaml`. It creates `web`, `worker`, the `kinetic-db` Postgres and the `kinetic-shared` env group.
3. Fill the `sync: false` values in the dashboard: `DATABASE_URL` (set in step 5), `BETTER_AUTH_SECRET`, `ORG_COOKIE_SECRET`, `BETTER_AUTH_URL`, `APP_BASE_URL` (the real service URL; never a hardcoded domain), `EMAIL_FROM`, `RESEND_API_KEY`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `ANALYTICS_HASH_SECRET`, the export bucket (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`; the bucket must be private), `EXPORT_LINK_SECRET`, and `POSTHOG_KEY` / `POSTHOG_HOST` when analytics should be on (`ANALYTICS_HASH_SECRET` is then required). Generate secrets with a password manager or `openssl rand -hex 32`. The worker refuses to boot in production without `RESEND_API_KEY` and `EMAIL_FROM` (there is no dev-sink fallback in production). Permanently failed outbox rows and job handler errors are reported to Sentry when `SENTRY_DSN` is set.
4. The first deploy runs `preDeployCommand` as the owner (`MIGRATION_DATABASE_URL` is wired from the database): `prisma migrate deploy`, then `pgboss:migrate`. Until step 5 is done the services cannot boot in production; that is expected.
5. As the owner, run `app-role.sql` (command above, against the database's external connection string; allow your IP in the database access list). **Confirm Render allows creating the role; if it does not, stop and escalate.** Then set `DATABASE_URL` in `kinetic-shared` to the `kinetic_app` connection string and redeploy both services.
6. **Verify role refusal**: temporarily set `DATABASE_URL` to the owner string and redeploy `web`; boot must fail with `Unsafe database role`. Restore the `kinetic_app` string.
7. Run the **Smoke (staging)** workflow with the web URL (`.github/workflows/smoke.yml`). Optional repository secrets `SMOKE_EMAIL` / `SMOKE_PASSWORD` enable the sign-in check. Expected: `/healthz` 200 and the login page renders. A Render background worker has no public URL; check it through its logs (`worker started`).
8. The seed is for demo data only and refuses to run with `NODE_ENV=production`. Mint the first real pilot code with `pilot-code:create` from a trusted machine with `MIGRATION_DATABASE_URL` set to the external owner string.

Owner credential handling: Render exposes service environment variables to the running process, so `web`'s `startCommand` is `exec env -u MIGRATION_DATABASE_URL ...`: the owner URL exists only during `preDeployCommand`. The worker never receives it, and with the role guard enforced both services refuse to boot if `MIGRATION_DATABASE_URL` is present in their runtime environment.

Post-pilot target (option b): run migrations from CI with the owner URL stored only in CI secrets, and remove `MIGRATION_DATABASE_URL` and `preDeployCommand` from Render entirely.

## Rollback

- **Application**: Render dashboard > service > Events > roll back to the previous deploy. Redeploys re-run `preDeployCommand`, which is a no-op when no migration is pending.
- **Migrations are forward-only.** Never edit an applied migration. To undo a schema change, ship a new migration, and keep each release compatible with the previous schema for one deploy (expand, then contract).
- **Secrets**: rotate by changing the dashboard value and redeploying. Rotate the runtime password by re-running `app-role.sql` with the new password, then updating `DATABASE_URL`.

## Background jobs (worker)

All jobs are pg-boss queues created by `pgboss:migrate`; scheduled ones are registered on boot. Every job is idempotent, so an overlapping or repeated run changes nothing.

| Job | Schedule | What it does |
| --- | --- | --- |
| `email.deliver` | outbox sweep (`OUTBOX_POLL_INTERVAL_MS`) | Sends queued emails with retries. |
| `pauses.end` | every 10 min | Ends pauses whose resume date arrived in the client's zone. |
| `checkins.issue` | every 10 min | Issues weekly check-ins at 06:00 client-local. |
| `review.sweep` | every 10 min | Marks missed/incomplete sessions, reopens snoozes, raises and auto-resolves review flags. |
| `exports.build` | every minute | Builds requested exports into the private bucket (3 attempts). |
| `deletions.run` | every minute | Runs verified deletion requests not on legal hold. |

A stuck job shows in the worker logs (`... failed`, never with content) and in Sentry. Re-running is safe.

## Exports

Exports are CSV objects under `exports/{organizationId}/{jobId}/` in the private bucket. Users download them only through `/api/v1/exports/:id/files/:name` with a 15-minute link bound to their account; the app re-checks the requester on every download. Files are offered for 7 days. **Lifecycle:** configure the bucket to delete `exports/` objects after 8 days (not automated by the app yet).

## Deletion requests (Journey E)

1. A client (portal Profile) or an owner (client Overview) requests deletion. The owner is emailed; the request is audited.
2. A platform admin opens `/admin`, checks the request (account lookup helps), and either **Verify and run**, **Reject** with a reason, or sets a **legal hold** (which stops the run until cleared).
3. Within a minute `deletions.run` erases the client's data in that workspace: workouts, logged sets and their revisions, check-ins, messages, flags, notes, pauses, invites, exports and the membership. The client row stays as "Deleted client" because immutable program history points at it. The user account is anonymized and signed out only when it has no other membership; other workspaces are never touched. Audit rows stay (they hold ids and actions only).
4. Target: done within 30 days of the request (D-008 #16). Backups expire within 35 days, so the data is gone from backups after that.

## Support access

A platform admin can read a client's data only after granting themselves access on `/admin` with a reason; a grant lasts 24 hours and can be revoked. Every grant, revoke and read is audited against the client's organization. Platform admins are set in the database (`users.is_platform_admin`) by the owner of the database.

## Performance check

`pnpm perf:dashboard` seeds a throwaway organization with 50 clients and times the dashboard's data load (p50/p75/p95 over 40 runs; fails above a 2.5 s p75). Run it with `DATABASE_URL` pointing at Postgres 16. Last result (2026-10-30, local container): p75 19 ms.

## Backups and restore

Render Postgres takes daily backups; retention must stay at or under 35 days (D-010). Restore drill (do it before the pilot, then quarterly):

1. In the Render dashboard, restore the latest backup to a **new** database (never over the live one).
2. Run `app-role.sql` against it (owner connection), then `assertRuntimeRole` through a local `pnpm dev` pointed at the restored `kinetic_app` URL; the app must boot.
3. Spot-check counts against the live database (clients, sessions, set logs) and sign in as a test coach.
4. Run the smoke workflow against a temporary web service pointed at the restored database, then delete the scratch database and service.
5. Record the date, the backup's timestamp, the person and any problems below.

| Date | Backup restored | By | Result |
| --- | --- | --- | --- |
| — | — | — | Not run yet (no hosted database exists). |
