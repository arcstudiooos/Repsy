# Review C — Sprint 5 (S5-1 … S5-5, S6-1) — PR arcstudiooos/GYM#2

Scope: e81ce1d, 681c989, 2aefba0, ba3162c, 30b1cea (checkout `D:\Gym-review` @ 30b1cea; diff base 0c4b688).
Method: read-only static review of code, migrations, tests and docs. No tests were run (none were needed to confirm a finding).

## Strengths

- **The erasure exemption is tightly confined.** `app.lawful_erasure` appears in exactly one code location: `packages/core/src/privacy/deletion.ts:153`/`:177`. It is transaction-local (`set_config(..., true)`). The trigger function (`migrations/20260101000029_deletion_support/migration.sql:91-100`) lets only `DELETE` on `set_log_revisions` through. `UPDATE`/`TRUNCATE` are always refused, and the function uses `pg_catalog.`-qualified calls. No migration has a `SECURITY DEFINER` function. App code never uses `$executeRawUnsafe` or `$queryRawUnsafe`. `TenantTx` omits `$executeRaw`/`$queryRaw` (`packages/db/src/tenant.ts:237-248`), so tenant code cannot issue `set_config`. The setting is still an application convention (any runtime-role SQL could set it), and the follow-ups doc says so honestly.
- **Erasure stays inside one organization.** Every delete is keyed by `{ organizationId, clientId }` or by the session/thread relation, under `withSystem`. Only the `client` membership in that org is removed. The user account is anonymized only when no memberships remain, which matches the dual-role test (`deletion.test.ts:153`). The claim `updateMany(status: verified, legalHold: false → processing)` happens in the same transaction, so a rerun or a concurrent run is a no-op. Audit metadata holds IDs only. The FK `programs → clients ON DELETE RESTRICT` is avoided because the client row is kept and anonymized.
- **Admin access checks are solid.** `isPlatformAdmin` is `input: false` in Better Auth (`apps/web/src/lib/auth.ts:96`), and no app code writes it. Every core admin function starts with `assertPlatformAdmin`, which answers 404. The proxy answers 404 for `/admin`, and so does the layout. Support reads require an unexpired, unrevoked grant from _this_ admin (`expiresAt > now` on every read). Each grant, revoke and read is audited.
- **Export downloads are well protected.** The HMAC token is bound to job, file and user, compared with `timingSafeEqual`, and lives 15 minutes. The requester and the expiry are re-checked on every download. Storage keys come only from the job record and pass `assertSafeKey`. S3 puts use SSE and no public URL is ever produced. Production refuses the filesystem fallback. Files are recorded on the job only after every object is written. A failed build removes what it wrote. Formula prefixes are neutralised.
- **Analytics follow the spec.** The event list matches the §13 list exactly. The adapter enforces the property allowlist plus a no-whitespace value regex. IDs are HMAC-SHA256 hashed and person profiles are disabled. Adherence uses `dueAt < now − grace`, excludes cancelled sessions, is tenant-scoped through `TenantTx`, and renders "No sessions due yet" for a zero denominator.

## Critical

None found.

## Important

### I-1 One failing erasure blocks every later deletion request

`apps/worker/src/jobs/deletionsRun.ts:36-37`. `runDeletions` calls `withSystem(eraseClientData)` in a loop with no `try/catch`. `exportsBuild.ts` handles the same case. If one verified request throws, the whole job throws. Causes include an FK violation from a future table, the interactive transaction timeout (see I-3), or an anonymized email that collides with a constraint. The next minute, the same request is picked first again, because of `orderBy: verifiedAt asc, take: 10`. Every request verified after it never runs, and nothing tells the admin. Lawful erasure (30-day target, D-008 #16) then silently stops.
**Fix:** wrap each request in `try/catch`. Log `{ deletionRequestId, errName }` and call `captureException`, then continue. Optionally record `attempts` and `last_error_code` on `deletion_requests`, and show failed or stuck rows in the admin queue.

### I-2 Erasure leaves the subject's personal data in `outbox_emails` and in client-copy program content

`packages/core/src/privacy/deletion.ts:150-178`.

- `outbox_emails` is never touched. After erasure these rows still hold the client's personal data:
  - Invite emails: `to_email` = the client's real address, plus a payload carrying the invite token (`invites.ts:93`).
  - `deletion_requested`: `payload.clientName` (`deletion.ts:77`).
  - `message_received` to the coach: `senderName` = the client's name (`messages.ts:328`).

  Nothing purges outbox rows, so these stay indefinitely. That contradicts Ruling 5 and D-008 #16.

- Client-copy programs are only renamed and archived (`deletion.ts:172-175`). Their immutable `workout_versions.title`/`notes` and `workout_version_exercises.note` stay. These are coach-written, client-specific text, often health-related ("left knee, avoid deep flexion"). Ruling 5 lists "their client copy programs" among the rows the job removes. The follow-ups doc justifies keeping the client row, but not this content.

**Fix:**

- Outbox: in the erasure transaction, delete or redact sent and pending outbox rows where `organization_id = org` and the row is addressed to the client (`to_email` = the old client email, or `to_user_id` = the subject when no other membership remains). Do the same for rows whose payload names the client (key them by an `idempotency_key` prefix that includes the client or thread id). Better: also add a retention sweep that deletes `sent` outbox rows after N days.
- Program content: either extend the lawful-erasure trigger exemption to `DELETE` on the client copy's versions (`program_versions`, `program_slots`, and `workout_versions` not referenced by any other program, under the same transaction-local flag), or document this explicitly as a residual in the privacy notice draft. Add a test asserting no client name or email remains anywhere for the erased client.

### I-3 Export build (and erasure) run inside Prisma's default 5 s interactive transaction, with network I/O inside it

`apps/worker/src/jobs/exportsBuild.ts:47-51` and `packages/core/src/exports/exports.ts:453-494`. `completeExport` runs inside `withTenant` (`$transaction` with no `timeout`; `packages/db/src/tenant.ts:269`, and `createPrismaClient` sets no `transactionOptions`). Inside that transaction it does two things:

- reads every session, set log and check-in of the organization;
- performs one S3 `PutObject` per file.

Prisma's default interactive-transaction timeout is 5 000 ms. A moderately sized organization will exceed it, and so will a slow S3 endpoint. The transaction then closes, the next query throws, and the job is retried 3 times. It then ends up `failed` for every attempt, so the org export is unusable exactly for the customers who need it most. The same 5 s cap applies to `eraseClientData` (about 20 sequential `deleteMany` calls for a long-tenured client), which feeds I-1.
**Fix:**

- Exports: build the CSVs in a read-only transaction with an explicit, generous `timeout` (or in several small reads), then do the storage puts _outside_ any transaction. Record `done` plus `files_json` in a short final transaction. The guarantee that files are listed last is unchanged.
- Erasure: pass `{ timeout: 60_000 }` or similar. This needs a `withSystem`/`withTenant` options parameter.

Add a test that builds an export for an org with a few thousand set logs, and a test with a slow fake storage.

## Minor

- **M-1 Export download does not re-check the role.** `packages/core/src/exports/exports.ts:151-176`. Only `requestedBy === actor.userId` is checked. Someone who requested an org export while owner keeps the full-org CSVs for 7 days after losing the owner role (demotion or ownership transfer). **Fix:** for `scope = 'org'`, also `assertCan(actor, 'export:org')`. For `client_self`, also require `job.clientId === actor.clientId`.
- **M-2 Org exports built before an erasure stay downloadable.** `deletion.ts:163-164` only touches exports with `clientId = subject`. An owner's org export (in storage, downloadable for 7 days, kept until the 8-day lifecycle rule) still contains the erased client's name, email, sessions and check-in answers. **Fix:** on erasure, expire (`expiresAt = now`) and delete the files of `done` org exports of that organization created before the erasure. At minimum, document it.
- **M-3 Admin routes validate input before the admin check, so non-admins can tell they exist.** `apps/web/src/server/routes/privacy.ts:41-110` with `api.ts` `readInput`. Zod runs before `assertPlatformAdmin`. A non-admin sending `GET /api/v1/admin/accounts` with no email, or `POST /api/v1/admin/support-grants` with `{}`, gets 400 VALIDATION instead of 404. **Fix:** check `ctx.user.isPlatformAdmin` before parsing input. For example, add `requirePlatformAdmin: true` on `RouteDef` and enforce it in `createApiHandler` before `readInput`. Extend the 404 test to send invalid bodies.
- **M-4 Account lookup is not audited and puts the email in the URL.** `packages/core/src/admin/admin.ts:107-140`, and `apps/web/src/app/admin/page.tsx:28` (`?email=` in the query string). It returns a person's name, email and memberships without any audit row, and the looked-up email lands in access logs and browser history. D-006 calls for audited support access. **Fix:** append an audit row (`support.account_lookup`, `{ userId }`) for each lookup that finds an account, and make the page form use POST, or a server action.
- **M-5 Analytics misconfiguration fails after the commit, and web and worker disagree on the hash secret.** `apps/web/src/server/analytics.ts:40-47`, `apps/web/src/server/api.ts:244-252`, `apps/worker/src/adapters/analytics.ts:32,37`. With `POSTHOG_KEY` set and `ANALYTICS_HASH_SECRET` missing in production, `track()` throws _after_ the business transaction committed. Every tracked mutation then returns 500, and clients retry non-idempotent creates such as `POST /programs`. The signup action throws after the account was created. The worker silently hashes with the public `'dev-only-analytics-hash-secret'`. Likewise, `assertAllowedEvent` throws in production from inside `track()`. **Fix:** validate the analytics env at startup (like `assertAuthEnv`) in both apps. Make `track()` never throw in production: catch, log and drop.
- **M-6 Analytics events can over-count.** `apps/web/src/server/routes/checkins.ts:106` emits `review_flag_opened {rule_key: 'checkin_new'}` on every new submission, whether or not `onCheckinSubmittedRules` actually opened a flag (for example, one already open is deduplicated). `reviewFlags.ts:38-40` emits `review_flag_resolved` even when the PATCH replays an already-resolved flag. **Fix:** have the hook or `updateFlag` return whether a state change happened, and emit only then.
- **M-7 CSV neutralisation misses some formula triggers.** `packages/core/src/exports/csv.ts:12`. It does not cover a leading LF, leading spaces before `=`/`+`/`-`/`@`, or the full-width `＝`/`＋`/`－`/`＠` (some spreadsheet locales evaluate these). Message bodies and short-text answers are user-controlled. **Fix:** test `/^[\s]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/`. Optionally prefix every text cell that starts with any of those characters.
- **M-8 The erasure job depends on export storage config.** `apps/worker/src/jobs/deletionsRun.ts:59`. `createStorage()` runs before any erasure, so a missing or invalid `S3_*` configuration in production stops every lawful deletion, even when there are no export files to remove. **Fix:** run the database erasure first, then create storage lazily only when `storageKeys.length > 0`, catching and logging any failure.
- **M-9 Erased client rows can be revived and edited.** `deletion.ts:180-194`, with `clients.ts` `nextClientStatus`. The anonymized "Deleted client" row can still be edited by the owner, and moved archived → invited and re-invited. This re-attaches a new person to the erased client's immutable program history. **Fix:** add an `erased_at` column, or test for an open or done deletion request, and refuse updates, invites and status changes for erased clients.
- **M-10 The database does not stop a user's own transaction from changing `is_platform_admin`.** `packages/db/prisma/migrations/20260101000007_app_current_org/migration.sql:53-63`. `users_write` lets a tenant transaction (with `app.user_id`) update _any_ column of the actor's own row, including `is_platform_admin`. No code path does this today: `TenantTx` callers never write `user`, and Better Auth has `input: false`. Sprint 5 makes the flag security-relevant, so add a guard. **Fix:** `REVOKE UPDATE (is_platform_admin) ON users FROM repsy_app`, or add a `BEFORE UPDATE` trigger that rejects changes to `is_platform_admin` unless `app_rls_bypass()`.
- **M-11 Exports have no rate limit and the link list is capped at 20.** `apps/web/src/server/routes/exports.ts:26-31` has no rate limit, and each new idempotency key queues a full org build (a cheap amplification against the worker). Separately, `exportLinksRoute` (`:38-46`) finds the job only among the last 20 via `listMyExports`. An older but still-live export then fails with 404 (`exportFileFor(..., '')` → file `''` not found). **Fix:** add `rateLimit` (for example, 5/hour) and reject a new request while one of the same scope is queued or running. In the links route, look the job up by id.
- **M-12 Out-of-org downloads return 404.** `exportFileRoute` uses `requireOrg: true`. A dual-role user whose active-org cookie points elsewhere gets 404 "Not found" on a valid link. **Fix:** document this, or resolve the export's org from the job (system lookup by id plus a requester check).
- **M-13 The `withSystem` sanctioned-uses list is out of date.** `packages/db/src/tenant.ts:281-300` does not list the new request-path `withSystem` users: the admin routes in `privacy.ts`, `/admin` pages, and `/admin/support/[clientId]`. **Fix:** add them to the comment.
- **M-14 Docs say "presigned GET" but the code streams through the app.** `docs/superpowers/plans/2026-10-30-sprint-5.md` Ruling 3/4 says "S3: presigned GET; StoragePort `signedGetUrl`". The code streams through the app instead, with no `signedGetUrl`. That is the better design, and `sprint-5-followups.md` explains it, but the plan was not amended. **Fix:** note the deviation in the plan or `decisions.md`.

## Declined to judge

- **Archive and invite revocation (prompt focus item 1).** `updateClient` archive (`packages/core/src/clients/clients.ts:347-362`) does not revoke open invites. Acceptance requires `status = 'invited'` (`invites.ts:214`), so an invite is dead while the client is archived. It could become valid again if the owner moves the client archived → invited before the invite expires. This code predates Sprint 5 (S2/S3) and is outside this review's commits; flagging it for whoever owns those sprints.
- **PostHog retention of `client_id_hash` after erasure.** The hashed events remain in PostHog. Whether pseudonymous product events need deletion is a counsel question, tied to the D-008 #17 privacy-notice drafts.
- **Statement-level timestamp skew in "made now" event dedupe.** `coach_message_sent` compares the message's `createdAt` with the app-clock `t0`; `createdAt` may be DB-defaulted. Clock skew between the app and Postgres could drop or duplicate an event. Low impact; not verified.
- **Performance budget evidence.** `pnpm perf:dashboard` measures the queries in-process on a throwaway DB, not an HTTP render. Whether that satisfies "p75 < 2.5 s" for §12 is a product call.
- **Hardening commit (30b1cea).** It contains no rate-limit, header, CSP, proxy or auth changes (docs, perf script, render.yaml secrets, a WorkoutLogger label tweak). Nothing weakens auth. The "rate limits verified" and "security review" claims are documentation only; I did not re-verify them beyond this review.
