# Architecture overview

Repsy is a pnpm monorepo deployed as two Render services (`web`, `worker`) sharing one Postgres database (D-005).

```
                +-----------+        HTTPS        +---------------------------+
   Browser ---->|  Render   |-------------------->|  web (Next.js + API)      |
                |  proxy    |  X-Forwarded-For    |  Better Auth, /api/v1     |
                +-----------+  (1 trusted hop)    +-------------+-------------+
                                                                |
                                          repsy_app (RLS)     |   SQL
                                                                v
                                                  +-------------------------+
                                                  |  Postgres 16            |
                                                  |  app tables (RLS forced)|
                                                  |  outbox_emails          |
                                                  |  pgboss schema (queue)  |
                                                  +------------+------------+
                                                               ^
                                           repsy_app, SQL    |
                                                  +------------+------------+
                                                  |  worker (pg-boss)       |
                                                  |  email sweep, jobs      |
                                                  +------------+------------+
                                                               | ports
                                      +------------------------+---------------+
                                      v                        v               v
                               EmailPort                 Sentry         (later: S3, PostHog)
                        Resend | DevSink (dev)
```

## Packages

| Package         | Role                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/web`      | Next.js app and `/api/v1`. Auth (Better Auth), org cookie, rate limiting, `/healthz`.                  |
| `apps/worker`   | pg-boss worker. Delivers the email outbox. Health server on `WORKER_PORT`.                             |
| `packages/core` | Domain logic: actor context, policies, signup, pilot codes, outbox. Never imports provider SDKs.       |
| `packages/db`   | Prisma schema, migrations, `withTenant` / `withSystem`, `assertRuntimeRole`, seed, `sql/app-role.sql`. |

## Rules that shape the design

- **Tenant isolation is enforced by Postgres**: Row-Level Security is FORCED on every `organization_id` table. `withTenant` sets `app.org_id` (and `app.user_id` for the acting user) per transaction; `withSystem` (worker, auth bootstrap, seed) sets `app.bypass_rls`.
- **`users` has forced RLS too.** A tenant transaction sees only members of the active org plus the acting user's own row, and may write only that own row. Better Auth runs outside any tenant and uses its own pool (`authPrisma`, `createAuthPrismaClient`) whose connections start with `app.auth_context=on`; only the `users` policy honours it, so tenant tables stay fail-closed on that pool. Auth tables (`accounts`, `sessions`, `verifications`, `rate_limits`, `pilot_codes`) have no RLS and are not part of `TenantTx`: the tenant client rejects them, and the `accounts` / `sessions` / pilot-code relations, at runtime.
- **Two database identities.** The owner (`MIGRATION_DATABASE_URL`) runs migrations and creates the `pgboss` schema. The runtime role `repsy_app` (`DATABASE_URL`) is NOSUPERUSER, NOBYPASSRLS, owns nothing, and cannot run DDL. In production (or `ENFORCE_RUNTIME_ROLE=true`) both services call `assertRuntimeRole` at boot and refuse a superuser, BYPASSRLS or table-owner connection.
- **Adapters at the edge.** `packages/core` talks to email through `EmailPort`. The worker picks Resend when `RESEND_API_KEY` is set, otherwise the dev sink (JSON files, named by timestamp and a hash of the idempotency key).
- **Outbox pattern.** Web writes `outbox_emails` rows in the same transaction as the change; the worker sweeps and delivers with retries. Workout logging and sync never depend on the worker (D-005 rule 4).
- **Client IP.** Rate limits use the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the end (Render: 1), never the client-supplied leftmost value.
- **Pilot access.** Sign-up requires a pilot code. Only its sha256 (of the normalized code) is stored; codes are shown once.
