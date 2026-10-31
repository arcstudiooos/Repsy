# PR arcstudiooos/GYM#2 — Review D: database / RLS / withSystem

Reviewer scope: `D:\Gym-review` at `30b1cea`, diff `991ae94..HEAD`. Migrations `20260101000023_client_pauses` … `20260101000029_deletion_support`, `packages/db/prisma/schema.prisma`, `packages/db/src/**`, `packages/db/sql/app-role.sql`, and every new non-test `withSystem(` call site.

Verification run: `pnpm --filter @kinetic/db db:diff` (shadow `kinetic_shadow` on :54320, main URL pointed at a dummy unreachable host): **"No difference detected", exit 0**. All 29 migrations replay cleanly on an empty database and the Prisma schema matches them.

## Strengths

- **Every new tenant table follows the contract.** The 11 new tables are `client_pauses`, `checkin_templates`, `checkins`, `conversation_threads`, `messages`, `review_flags`, `internal_notes`, `export_jobs`, `deletion_requests` and `support_access_grants`. Each has `organization_id UUID NOT NULL`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and the standard `tenant_isolation` policy (`organization_id = app_current_org() OR app_rls_bypass()`) for both USING and WITH CHECK.
- **Composite tenant FKs are complete.** Every tenant parent link is a composite `(fk, organization_id)` FK. This covers `clients.checkin_template_id`, `checkins.template_id` and `messages.thread_id`, and `(id, organization_id)` unique keys were added where the table is itself a parent. Links to `users` are plain FKs, which is correct.
- **`tenantIntegrity.test.ts` covers every new composite FK** with a cross-org negative case (`client_pauses`, `checkins` ×2, `clients -> checkin_templates`, `conversation_threads`, `messages`, `review_flags`, `internal_notes`, `export_jobs`, `deletion_requests`, `support_access_grants`).
- **`rls.test.ts` lists all 11 new tables** in both the forced-RLS list and the `tenant_isolation` policy list.
- **Grants are unchanged.** `app-role.sql` default privileges give new tables only `SELECT, INSERT, UPDATE, DELETE`: no TRUNCATE and no DDL. `kinetic_app` owns nothing, so FORCE RLS applies.
- **The `app.lawful_erasure` check is written safely.** It uses `pg_catalog.current_setting('app.lawful_erasure', true)`, so a missing setting returns NULL rather than raising, and it compares with `OPERATOR(pg_catalog.=)`. The exemption only lets DELETE through; UPDATE and TRUNCATE still raise. The erasure job sets it transaction-locally (`set_config(..., true)`) and switches it off again inside the same transaction.
- **CHECK constraints model the state rules well:** pause 1–90 days, check-in submission shape, review-flag state, export scope/files, and message and note body length. Partial unique indexes enforce one open pause per client and one open deletion request per client.
- **Worker jobs follow the right pattern.** `checkinsIssue`, `pausesEnd`, `reviewSweep` and `exportsBuild` use `withSystem` only to enumerate due orgs or rows, then do the work inside `withTenant(organizationId, …)`.
- **Every admin core function calls `assertPlatformAdmin` first.** `isPlatformAdmin` is a Better Auth field with `input: false`, so a user cannot set it. `readClientForSupport` additionally requires this admin's unexpired, unrevoked grant, and every read is audited.
- **`app_message_email_opt_in` is narrow.** It reveals exactly one boolean, only for a member of `app_current_org()`, and the bypass is scoped to the function call.

## Critical

None found.

## Important

### I1. New request-path `withSystem` uses are not in the sanctioned inventory, and the platform-admin gate runs inside the bypass transaction

- **Where:** `packages/db/src/tenant.ts:280-301` (doc comment unchanged in this PR); `apps/web/src/server/routes/privacy.ts:37,48,59,64,77,87,97,105,117`; `apps/web/src/app/admin/page.tsx:31`; `apps/web/src/app/admin/support/[clientId]/page.tsx:22`.
- **What:** This PR adds 11 request-path `withSystem` call sites: 9 admin API routes and 2 admin pages. The doc comment says "Add a line here before adding another", but it was not updated. The new sites also break the invariant the comment states: sanctioned uses "touch only rows keyed by the caller's own user id or by a secret they hold". The admin console reads and writes rows of every organization. The routes are `requireOrg: false`, so any signed-in user reaches them. The only gate is the `assertPlatformAdmin` call inside each core function, which runs after RLS bypass is already on.
- **Why:** Today every admin core function checks first, so there is no live exposure. But if a future admin function omits `assertPlatformAdmin`, any authenticated user gets cross-tenant read/write under bypass. Nothing at the route or db layer would catch it.
- **Fix:**
  1. Add a new category to the `withSystem` doc: "Platform-admin console (`core/admin`, web `server/routes/privacy.ts` admin routes, `app/admin/**`): only after `assertPlatformAdmin`; cross-org by design; every mutation and support read is audited."
  2. Move the check in front of the bypass. Use either a `withPlatformAdmin(user, fn)` wrapper in web, or `assertPlatformAdmin(adminOf(ctx))` in each handler before calling `withSystem`. Keep the in-core assert as defense in depth.
  3. Consider an architecture or grep test that fails when a new non-test `withSystem(` site appears outside an allow-list.

### I2. `deletion_requests` and `support_access_grants` are fully writable from tenant scope; the erasure worker and the support gate trust fields only a platform admin should set

- **Where:** `packages/db/prisma/migrations/20260101000029_deletion_support/migration.sql:103-113` (generic `FOR ALL tenant_isolation` policies). `packages/db/src/tenant.ts:236-248` (`TenantTx` exposes `deletionRequest` and `supportAccessGrant`).
- **What:**
  - **Deletion requests:** `runDeletions` / `eraseClientData` irreversibly erase a client when a row has `status = 'verified' AND legal_hold = false`. Under the current policy, any `withTenant` transaction for that org can create a row already `verified`, or update `status` / `legal_hold` / `verified_by`.
  - **Support grants:** any tenant transaction can insert a grant naming any `admin_user_id`, extend `expires_at`, or clear `revoked_at`.
  - **Today's writers:** the only legitimate tenant-scope write is `requestDeletion` creating a `requested` row (`core/privacy/deletion.ts:53`). Every other write to either table is system-scope (`core/admin/admin.ts`, `deletion.ts`).
- **Why:** One later bug turns into irreversible data loss or unaudited support access:
  - an owner-facing "cancel request" endpoint that spreads input into `data`;
  - a generic update helper;
  - a mass-assignment slip like `requestDeletion`'s `as never` cast.

  RLS is the stated isolation boundary, and here it allows far more than the app needs.

- **Fix:** Replace the `FOR ALL` policies with split policies.

  ```sql
  -- deletion_requests
  CREATE POLICY tenant_select ON deletion_requests FOR SELECT
    USING (organization_id = app_current_org() OR app_rls_bypass());
  CREATE POLICY tenant_request ON deletion_requests FOR INSERT
    WITH CHECK (app_rls_bypass() OR (organization_id = app_current_org()
      AND status = 'requested' AND NOT legal_hold AND verified_by IS NULL
      AND verified_at IS NULL AND completed_at IS NULL AND rejected_reason IS NULL));
  CREATE POLICY system_write ON deletion_requests FOR UPDATE USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
  CREATE POLICY system_delete ON deletion_requests FOR DELETE USING (app_rls_bypass());
  -- support_access_grants: SELECT for the org (transparency) or bypass; INSERT/UPDATE/DELETE bypass only.
  ```

  Then update `rls.test.ts`. Its "policies use app_current_org" test keys on `policyname = 'tenant_isolation'`, so add assertions for the new policy names and a behavioural test that a tenant transaction cannot set `status = 'verified'`. Optionally reject writes to these two models in the tenant extension (a "system-write-only" set beside `NON_TENANT_MODELS`).

### I3. Messages are documented immutable, but DELETE is unguarded from any scope

- **Where:** `packages/db/prisma/migrations/20260101000025_messages/migration.sql:72-90` (`messages_immutable` is `BEFORE UPDATE` only).
- **What:** Any tenant transaction can `tx.message.delete*` and silently remove conversation history. RLS limits this only to the same org, and no core code path needs it outside erasure (`deletion.ts:157`). This PR gave `set_log_revisions` a gated DELETE for exactly this case; `messages` did not get the same treatment.
- **Why:** This is a missing constraint that a later bug, such as a client-side "delete message" feature or a cleanup helper, would turn into silent data loss of a record the design says is immutable.
- **Fix:** Add a `BEFORE DELETE … FOR EACH ROW` trigger on `messages` that raises unless `pg_catalog.current_setting('app.lawful_erasure', true) OPERATOR(pg_catalog.=) 'on'`, plus a `BEFORE TRUNCATE` statement trigger. The erasure job already sets the flag before deleting messages (`deletion.ts:153-157`), so no code change is needed there.

### I4. Erasure can leave the erased client's data in private storage with no record left to retry

- **Where:** `apps/worker/src/jobs/deletionsRun.ts:37-48`; `packages/core/src/privacy/deletion.ts:163-164`.
- **What:**
  1. `eraseClientData` deletes the `export_jobs` rows (the only record of the object keys) and commits. Only then does the worker call `storage.deleteMany(keys)`. If that fails, it only logs (`'export files not removed'`). The keys are gone from the database, so nothing retries, and no expiry sweeper deletes export objects.
  2. Only `client_self` exports are matched (`inClient` filters on `client_id`). Organization exports (`scope = 'org'`, `client_id NULL`) also contain the client's rows, and they are left untouched.
- **Why:** Lawful erasure is incomplete (PII retained) and the failure cannot be recovered.
- **Fix:**
  - Record the keys durably in the same transaction before deleting the rows. Options: a `storage_deletions(key, organization_id, created_at)` table processed by the worker until it succeeds, or mark export rows `purge_pending` instead of deleting them.
  - Purge or expire this org's `org`-scope exports created before `completed_at`, or document why they are retained.
  - Add an expiry sweeper for `expires_at < now()` export objects.

## Minor

### M1. `app_message_email_opt_in` runs with bypass on but has no pinned `search_path` and unqualified names

- **Where:** `packages/db/prisma/migrations/20260101000025_messages/migration.sql:108-118`.
- **What:** The body references `notification_preferences`, `memberships` and `app_current_org()` unqualified, and the function has no `SET search_path`. Postgres searches `pg_temp` first for relations, so a session that can `CREATE TEMP TABLE memberships(...)` can make the function return any user's opt-in while bypass is on. This contradicts the hardening in migration `000008` ("Harden the RLS helper functions against search_path shadowing"). EXECUTE is granted to PUBLIC by default. Default privileges in `app-role.sql` cover only tables and sequences, not functions.
- **Why:** This is not exploitable beyond today's trust level, because `kinetic_app` can already `SET app.bypass_rls` with raw SQL. It becomes a real escalation the day bypass is gated by role. It is also the only bypass-elevating function in the schema.
- **Fix:** Create the function inside a `DO` block so the migrated schema is pinned, for example `EXECUTE format('CREATE FUNCTION … SET app.bypass_rls = ''on'' SET search_path = %I, pg_temp AS …', current_schema())`. That works with per-run test schemas. Inside the body, use `OPERATOR(pg_catalog.=)`. Then add `REVOKE EXECUTE ON FUNCTION app_message_email_opt_in(uuid) FROM PUBLIC;` and rely on `app-role.sql`'s `GRANT EXECUTE ON ALL FUNCTIONS`. Note in the runbook that `app-role.sql` must be re-run after this migration.

### M2. Any transaction can set `app.lawful_erasure`

- **Where:** `packages/db/prisma/migrations/20260101000029_deletion_support/migration.sql:91-100`.
- **What:** Custom GUCs can be set by any role, and the trigger checks only `app.lawful_erasure`. Any transaction, including a tenant one through a raw-SQL cast like the one in `preferences.ts`, can enable DELETE on its org's revision history. Migration `000022` promised "no exemption for system code or RLS bypass"; the exemption is now broader than system code.
- **Fix:** Require system scope too: `AND app_rls_bypass()`. Optionally require a matching `app.erasure_request_id` setting. Add a test that a tenant transaction with the flag set still cannot DELETE.

### M3. The `TenantTx` raw-SQL omission is type-only, and this PR adds a cast around it

- **Where:** `packages/db/src/preferences.ts:9`.
- **What:** `(tx as unknown as Pick<SystemTx,'$queryRaw'>).$queryRaw` works because the tenant transaction carries `$queryRaw` at runtime. It is acceptable inside `packages/db`, which is the trusted layer. But GUC-based gates (`app.bypass_rls`, `app.lawful_erasure`) stand only on that type omission.
- **Fix:** Add a lint rule (no-restricted-syntax) or architecture test forbidding `as unknown as Pick<SystemTx` and `$queryRaw` / `$executeRaw` on tenant transactions outside `packages/db/src`.

### M4. Missing or ill-fitting indexes for queries the code runs

- `apps/worker/src/jobs/checkinsIssue.ts:15-18` scans all clients across all orgs with `status='active' AND checkin_weekday IS NOT NULL`, and no index supports it. Add `CREATE INDEX … ON clients (organization_id) WHERE checkin_weekday IS NOT NULL AND status = 'active'`.
- `core/privacy/deletion.ts:111` (`deletionStatusFor`) finds by `subject_client_id ORDER BY created_at DESC` across all statuses. Only the partial (open-status) unique index exists, and it cannot serve that query. Add `(subject_client_id, created_at)`.
- `apps/worker/src/jobs/deletionsRun.ts:27-31` filters `status='verified', legal_hold=false ORDER BY verified_at`. The `(status, created_at)` index only partly serves it. This is fine at pilot scale.

### M5. `support_access_grants.client_id` FK is `ON DELETE CASCADE`

- **Where:** `migration.sql` (000029) line 78.
- **What:** Every other tenant FK uses RESTRICT, and grants are audit-relevant. Clients are anonymized, not deleted, so this has no effect today.
- **Fix:** Use `RESTRICT` (and `onDelete: Restrict` in schema.prisma).

### M6. Erasure leaves client-identifying content in other tenant tables

- **Where:** `deletion.ts:133-235`.
- **What:**
  - `outbox_emails` payloads (for example `deletion_requested.clientName`, message-notification emails) are not purged.
  - Archived client-copy programs keep their `program_versions` and `program_slots` content (coach notes may name the client).
  - `audit_events.metadata.clientId` is kept, which is fine because it carries no content.
- **Fix:** Purge or redact `outbox_emails` for the client's `user_id` / `org`, and decide explicitly about client-copy version content. Document the decision in the erasure doc comment.

### M7. Unvalidated schema string in connection options

- **Where:** `packages/db/src/client.ts:18`.
- **What:** `-c search_path=${schema},public` interpolates `schema` unvalidated into libpq `options`. A space in the value would inject further `-c` options. Only tests pass `schema` today.
- **Fix:** Assert `/^[a-z_][a-z0-9_]*$/` before building the string.

### M8. `tenantIntegrity.test.ts` check-in rows use random dates

- **Where:** `packages/db/src/tenantIntegrity.test.ts:148`.
- **What:** `periodLocalDate` uses a random year. A collision would surface a unique violation instead of the expected FK violation, because the unique index fires before the deferred FK check. This is very unlikely.
- **Fix:** Use a deterministic date per case.

## Declined to judge

- Role-level isolation inside an org (clients vs coaches on `internal_notes`, `review_flags`, `support_access_grants` visibility to owners) is enforced in `@kinetic/core` policy, not RLS. I did not audit every core read path.
- I did not run the integration or test suites (`rls.test.ts`, `tenantIntegrity.test.ts`, `deletion.test.ts`). I read them; only `db:diff` was executed. I did not verify end to end that `eraseClientData`'s delete order satisfies every RESTRICT FK, for example `workout_versions` and other children of `workout_sessions`. A failure there would roll back and retry every minute rather than corrupt data.
- Storage-layer access control for export objects and signed export links (`apps/web/src/server/exportLinks.ts`) is outside the database scope.
- Whether organization owners should see `support_access_grants` rows for their org (transparency vs. disclosure of the support process) is a product decision.
