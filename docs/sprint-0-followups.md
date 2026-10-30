# Sprint 0 — Follow-ups

Sprint 0 (Foundations) was completed on branch `sprint-0` (2026-10-29). Every task passed a task review, and the whole branch passed a final review after one round of fixes. This file lists what was knowingly deferred, so later sprint plans pick it up. Items are grouped by when they must land.

## Must land first in Sprint 1 (before any route writes users)

- **Tenant relation guard misses nested writes.** `rejectNonTenantRelations` in `packages/db/src/tenant.ts` checks `include`/`select`/`where` but not `data`, so a nested `accounts`/`sessions` `connect`/`create` through `tx.user.update` is still reachable. It also misses `_count`. Fix: walk `data` and reject `_count` on user relations, and add tests.

## Sprint 1 — first migration

- Add a shared SQL function `app_current_org()` that returns `uuid` and use it in all RLS policies, replacing the `organization_id::text` comparison so indexes are usable. Do this before ~10 more tenant tables copy the policy.
- Add a CI step: `prisma migrate diff --exit-code` (schema vs migrations).
- Before S1-1 puts client PII into Prisma arguments, the API catch-all must stop logging raw `error.message`. Log the error name/code and stack only.

## Sprint 1 — specific tickets

- **S1-2:**
  - an org-switch endpoint (`serializeOrgCookie` is ready)
  - a role-based redirect at `/` (clients go to `/portal`)
  - a narrow db helper for invite lookup by token hash instead of ad-hoc `withSystem` in request code
- **S1-3:** session revocation UI ("sign out all"), using Better Auth `/revoke-sessions`. Confirm the `/settings` proxy guard.
- **First real screen:** add a 768px viewport check and an `aria-current` assertion to `shell.spec.ts`.
- **S2-1:** a portal sign-out control.

## Before the first deploy (Render — currently deferred by the founder)

- **`assertRuntimeRole` coverage:** check every non-system schema (including `pgboss`) plus `pg_has_role(current_user, owner, 'USAGE')`. A NULL `current_schema()` currently passes.
- **Revoke migration-history DML:** revoke DML on `_prisma_migrations` from `kinetic_app`.
- **Better Auth IP:** align Better Auth's IP detection (`advanced.ipAddress`) with `clientIp` / `TRUSTED_PROXY_HOPS`.
- **Deploy ordering:** web runs migrations in preDeploy before the worker starts new code. Sequence the deploys or document the order.
- **Smoke credentials:** staging smoke uses `SMOKE_EMAIL` credentials, because the seed refuses `NODE_ENV=production`. The pilot has a single environment in `render.yaml`. Update plan S0-7 to match.
- **Production checks and pins:** trim `RESEND_API_KEY`/`EMAIL_FROM` before the production check; pin GitHub Actions to SHAs.
- **`pg_stat_statements` warning:** note in the runbook that `pg_stat_statements.track=all` would record the nested `ALTER ROLE … PASSWORD` text.
- **Push to a remote** so CI runs at least once.

## Can wait (tracked, low risk)

- **db package:**
  - `appendAudit` `orgId` field is silently overridden inside a tenant tx
  - `TRUNCATE` on `audit_events` is not trigger-blocked (the runtime role has no TRUNCATE grant)
  - `createTestDb` connection cleanup; audit test ordering; upsert cross-org test swallows errors; `createTestDb` does not re-assert NOBYPASSRLS
  - the `prisma` Proxy only implements `get`; the interactive transaction has the default 5s timeout (revisit for S4/S5 sweeps and exports)
  - a tenant can delete its own Organization row (FKs restrict it in practice); decide in S5-3
- **Worker and outbox:**
  - `enqueueEmail` type cast
  - global `idempotencyKey` uniqueness (keys are server-built; document the convention)
  - worker `PORT` validation; health is liveness only
  - outbox success/failure writes not conditioned on the lease
  - the payload of a reclaimed-then-sent row is not cleared
  - pre-fix outbox rows may hold raw tokens (pre-launch only)
- **Auth and sign-up:**
  - `/api/dev/emails` should also require an explicit `ENABLE_DEV_EMAIL_SINK` opt-in
  - `redeemPilotCode` two-codes race
  - a verification email can still be sent after a compensated sign-up
  - per-email sign-up lockout
  - Google account-linking policy (decide before Google keys are added)
  - add a test that `isPlatformAdmin` is ignored at sign-up (before `/admin`, S5-3)
- **API:**
  - anonymous session lookup happens before the limiter
  - `ApiResult` accepts any status
  - an integration test for cross-user org-cookie replay
  - all anonymous traffic shares `ip:unknown` when `X-Forwarded-For` is missing
- **Code duplication:** pilot-code functions are imported by relative path from db scripts; the E2E normalization copy; the duplicated enforcement predicate (export `runtimeRoleEnforced(env)`); Crockford alias mapping.
- **Tooling:**
  - ~~`pnpm dev` and `pnpm test:e2e` share `apps/web/.next`~~ (done: E2E builds into `.next-e2e`, port 3200)
  - a Playwright hard-kill leaves `.state.json`
  - E2E runs `next dev`, not `next start`
  - `docs/decisions.md` and `docs/implementation-plan.md` are not Prettier-formatted
  - docker compose `restart: unless-stopped`
