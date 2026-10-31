# PR #2 review — status and hand-over

Pull request [arcstudiooos/GYM#2](https://github.com/arcstudiooos/GYM/pull/2) covers Sprints 3–5. It merges branch `claude/sprint-3-wip-9t9dd0` into `master`. Do not merge it until the open items below are done.

The review covered commits `991ae94..30b1cea`. Commits up to `991ae94` (Sprint 3 Tasks 3.1–3.5) had already been reviewed task by task. Four reviewers each read one area, and their full reports are in `docs/pr-2-review/`:

- `review-A-pause-offline.md`: pause and resume (Tasks 3.6–3.7), and offline logging (Tasks 3.8–3.9).
- `review-B-sprint4.md`: check-ins, messages, the review sweep and rules, the review queue, and internal notes.
- `review-C-sprint5.md`: analytics, exports, deletion and erasure, the admin console, and hardening.
- `review-D-db.md`: migrations 000023–000029, row-level security (RLS), and every place that opens a `withSystem` transaction.
- `rereview-F1.md` and `fix-F1-report.md`: the re-review of the offline fix, and the fixer's own report.

Each report lists its Minor findings with file and line, and a suggested fix.

**Totals:** 1 Critical, 15 Important, and about 44 Minor. Reviewer A found 10 Minor issues, B found 12, C found 14 and D found 8.

## Baseline checks on `30b1cea`, before any fixes

- **Install, lint, typecheck and formatting:** all pass. Lint reports 0 errors and the same 2 warnings as before.
- **Unit and integration tests:** 773 of 774 pass. The one failure was `catalog.test.ts`, caused by Windows CRLF line endings in a fresh checkout. Commit `21a0de2` fixes it by adding a `.gitattributes` rule that keeps LF line endings.
- **Browser tests (`pnpm test:e2e`):** 72 pass, 4 are skipped and 2 fail. Both are fixed in `04ffe04` (details below each):
  1. **`e2e/checkins.spec.ts:15`.** The test's `issueCheckinNow` helper (`e2e/support/db.ts:270`) fails with a duplicate-key error on `checkins_client_id_period_local_date_key`. The worker's `checkins.issue` job inserts the same check-in at the same time as the helper. **Plan:** make the helper `ON CONFLICT DO NOTHING` and then select the existing row, or stop the E2E worker's issuing job for this spec. **Done:** the helper inserts with `ON CONFLICT DO NOTHING` and returns the existing row.
  2. **`e2e/pause.spec.ts:58`.** The server's validation message "Pick a date after the pause starts." never appears. Either the dialog never submits when the resume date equals the start date, or the API returns a different field or message. This may depend on the date or time zone. **Plan:** reproduce with `npx playwright test pause` and compare the dialog's field names with the 422 response from `POST /api/v1/clients/:id/pause`. Fix this together with B I-2 below. **Done:** it did not reproduce on Linux, in UTC or in Asia/Kolkata (dialog and API agree). It was the first request to the pause route on a cold dev server: the assertion now waits 15 s, like the spec's other server-backed steps. A separate one-off failure in this spec (an axe `color-contrast` hit on `div[data-title=""]`, likely a toast still fading in) did not recur in repeated runs.

## Findings and their status

### Critical

| ID   | Area                                                                 | Finding                                                                                                                                                                                                                             | Status                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A-C1 | Offline sign-out (`sw.js`, `SignOutButton.tsx`, `offline/outbox.ts`) | Sign-out cleared nothing: not the service-worker page cache, not IndexedDB, and not the registration. Offline, the next user could open the previous user's portal and workout pages, and that user's unsent writes were then lost. | **Fixed in `d186da3`.** Device data is bound to its owner, and sign-out flushes, asks for confirmation and wipes the data. A round-2 follow-up (N1) is in progress, see below. |

### Important

| ID                            | Area                                                                                | Finding                                                                                                                                                                                                                                                                                                                                                                | Status                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A-I1                          | Outbox                                                                              | Writes the server refused were deleted and the page showed "Synced". One bad set refused the whole batch, and the completion was still sent.                                                                                                                                                                                                                           | **Fixed in `d186da3`**                                                                                                      |
| A-I2                          | Outbox                                                                              | "Retry" after a clock-skew error never re-stamped the time. Queue order used the wall clock, and a blocked item did not hold back the items after it.                                                                                                                                                                                                                  | **Fixed in `d186da3`**                                                                                                      |
| A-I3                          | Offline sync loop                                                                   | Sync ran only while a workout page was open (D-004 #4 requires automatic sync).                                                                                                                                                                                                                                                                                        | **Fixed in `d186da3`.** The loop now runs from the portal layout.                                                           |
| A-N1 (re-review)              | `SignOutButton.tsx:36`, `offline/db.ts:151-170`                                     | Sign-out fails open. An IndexedDB error is swallowed, the page caches are cleared only after the database clear succeeds, and a failed pending count skips the warning.                                                                                                                                                                                                | **In progress, uncommitted.** See "Uncommitted work".                                                                       |
| A-M1 (cheap, part of round 2) | `sw.js`                                                                             | A failed `cache.put` serves the cached page while online.                                                                                                                                                                                                                                                                                                              | In progress, part of round 2                                                                                                |
| A-residual                    | `sw.js`                                                                             | A session that ends without a sign-out (expiry, or "sign out all devices" from elsewhere) leaves the cached pages in place. **Planned fix:** delete the `kinetic-pages-*` caches when an online `/portal` navigation gets a redirect or a 401. Also delete the page caches again after `authClient.signOut()` returns.                                                 | In progress, part of round 2                                                                                                |
| B-I1                          | `core/review/rules.ts:145-165, 213-231`                                             | The dedupe key for the missed-workouts rule (Rule 1) and the unread-message rule (Rule 4) is reused after a coach resolves the flag, so new misses raise no flag for up to 7 days.                                                                                                                                                                                     | **Fixed in `04ffe04`** (re-review pending)                                                                                  |
| B-I2                          | `core/clients/pause.ts:177`, `review/rules.ts:137`, `checkins/checkins.ts:406`      | A pause booked for a future date sets the client to `paused` straight away. Check-ins and Rule 1 then stop early, against D-003 and D-010 #3. The cause is planning Ruling 6. **Fix direction:** set `paused` only from the start date (with the worker job also starting pauses), or make the rules and check-ins test the pause's date window instead of the status. | **Fixed in `04ffe04`.** Status stays `paused` from booking; issuing and Rules 1–2 test the pause dates (re-review pending)  |
| B-I3                          | `WorkoutLogger.tsx:425,472`, `sessions/types.ts:16`, `portal/page.tsx:80`           | The API allows starting a `missed` session and finishing an `incomplete` one, but the portal offers neither. An active workout that the sweep marked `incomplete` shows as finished after a reload.                                                                                                                                                                    | **Fixed in `04ffe04`** (re-review pending)                                                                                  |
| B-I4                          | `worker/jobs/reviewSweep.ts:22-25`, `checkins` issuing loop, `db/src/tenant.ts:269` | Each organization's sweep runs as one interactive transaction with Prisma's default 5-second timeout, and there is no per-organization `try/catch`. A backlog times out every run, and one bad organization stops all later ones.                                                                                                                                      | **Fixed in `04ffe04`.** Per-org `try/catch` and a 120 s / 60 s timeout; derivation is still per session (re-review pending) |
| C-I1                          | `worker/jobs/deletionsRun.ts:36-37`                                                 | One failing erasure blocks every later deletion request forever: there is no per-request `try/catch`, and the same request is retried first every minute.                                                                                                                                                                                                              | **Fixed in `2dca49d`.** `attempts` / `last_error_code`, shown in the admin queue (re-review pending)                        |
| C-I2                          | `core/privacy/deletion.ts:150-178`                                                  | Erasure skips `outbox_emails`, which still hold the client's email and name. Client-copy programs, with their workout version titles and notes, are only renamed; Ruling 5 requires removing them.                                                                                                                                                                     | **Fixed in `2dca49d`.** Migration 000031 lets lawful erasure delete committed program history (re-review pending)           |
| C-I3                          | `worker/jobs/exportsBuild.ts:47-51`, `core/exports/exports.ts:453-494`              | The export build and erasure run inside the default 5-second interactive transaction, and the export build does its S3 uploads inside it. Medium-sized organizations fail.                                                                                                                                                                                             | **Fixed in `2dca49d`** (re-review pending)                                                                                  |
| D-I1                          | `db/src/tenant.ts:280-301`, `web/server/routes/privacy.ts`, `app/admin/*`           | 11 request-path `withSystem` uses were missing from the inventory, and the platform-admin check ran inside the bypass transaction.                                                                                                                                                                                                                                     | **Fixed in `ab90168`** (fix group 2)                                                                                        |
| D-I2                          | `migrations/…000029_deletion_support/migration.sql:103-113`                         | `deletion_requests` and `support_access_grants` used the generic tenant policy for all operations. A tenant transaction could mark a request `verified`, which triggers erasure, or forge or extend support grants.                                                                                                                                                    | **Fixed in `4dfae04`.** A new migration splits the policies.                                                                |
| D-I3                          | `migrations/…000025_messages/migration.sql:72-90`                                   | The message immutability trigger covered UPDATE only, so DELETE and TRUNCATE were unguarded.                                                                                                                                                                                                                                                                           | **Fixed in `4dfae04`.** The `app.lawful_erasure` exemption still applies.                                                   |
| D-I4                          | `worker/jobs/deletionsRun.ts:37-48`, `core/privacy/deletion.ts:163-164`             | Erasure deletes the export rows and commits before it deletes the stored files. If storage removal fails, it is only logged, nothing retries, and the file keys are lost. Organization-wide exports that contain the client's data are not touched.                                                                                                                    | **Fixed in `2dca49d`.** Keys stay on the export row until a purge sweep confirms; org exports expired (re-review pending)   |

Fix group 2 (D-I1, D-I2, D-I3) has **not had its re-review yet**. Its fixer's report was not finished when this hand-over was written: check whether `fix-F2-report.md` exists, and run `pnpm test` plus `db:diff`.

### Minor

There are about 44 Minor findings, listed by ID with file, line and suggested fix in the four `docs/pr-2-review/review-*.md` files. Three were fixed along with fix groups 3 and 4 (B M-2, C M-2, C M-8, marked below); the rest are open. Before merging, move them into `docs/pr-2-review-followups.md` (as the review brief asks) and triage them.

Notable ones:

- **Overdue flags during a pause (B M-2):** check-in overdue flags are raised for paused clients. **Fixed in `04ffe04`.**
- **Background tabs mark messages read (B M-6):** polling in a background tab marks messages read and silences Rule 4.
- **Duplicate send returns 500 (B M-4):** two concurrent sends of the same message give a 500 instead of the stored message.
- **Old org exports stay downloadable (C M-2):** an organization export built before an erasure can still be downloaded. **Fixed in `2dca49d`** (expired and purged). C M-8 (erasure needs storage config) is also fixed there.
- **Admin routes reveal themselves (C):** non-admins get a 400 before the admin check, so they can tell the routes exist.
- **Account lookup (C):** it is not audited, and it puts the email in the URL.
- **Analytics secret (C):** if `ANALYTICS_HASH_SECRET` is missing while `POSTHOG_KEY` is set, requests return 500.
- **CSV formula escaping (C):** some formula prefixes are missed.
- **`is_platform_admin` (C):** a user's own transaction can update it.

## Fix groups

1. **Offline (A-C1, I1–I3):** round 1 is done (`d186da3`) and was re-reviewed: C1 and I1–I3 confirmed fixed. Round 2 (N1, M1 and the residuals) is **in progress and uncommitted**.
2. **Database and admin (D-I1–I3):** committed in `4dfae04` and `ab90168`. **Re-review pending.**
3. **Privacy jobs (C-I1–I3, D-I4):** committed in `2dca49d` (cloud session). **Re-review pending.**
4. **Sprint 4 (B-I1–I4) and the two failing browser tests:** committed in `04ffe04` (cloud session), with B M-2 (no overdue flags during a pause). **Re-review pending.**

### Fix groups 3 and 4: what changed, and decisions for the re-review

- **Erasure (C-I2).** It now deletes the client's program copies: versions, slots, and only the workout versions that no template or other copy uses (a copy shares its template's workout versions until it is edited). Migration 000031 changes `forbid_history_mutation()` so committed history allows `DELETE` under `app.lawful_erasure = 'on'`; `UPDATE` and `TRUNCATE` are still always refused. The client row is still kept and anonymized: the deletion request and the audit trail point at it. It also deletes outbox emails in the organization that are addressed to the client (by address or account) or name them (`deletion-requested:<request>`, `new-message:<message>`, `client_invite:<invite>`), and the user's platform emails when the account is anonymized.
- **Exports (D-I4, C-M-2).** Erasure no longer deletes export rows. It expires the client's own exports and every org export created before the erasure (`expires_at = now`), re-queues a running org build, and fails the client's queued or running exports (`ERASED`). `exports.build` now also runs `purgeExpiredExports`: for every `done` export past its expiry it deletes the files, then sets `purged_at`, retrying until storage confirms. This also covers the plain 7-day expiry (the "expiry sweeper" the review asked for).
- **Export build (C-I3).** `completeExport(run, …)` takes a transaction runner: one read transaction (120 s), the storage writes outside any transaction, and a short `done` transaction that only applies while the job's claim (`claimed_at`) still holds; otherwise the files it wrote are removed.
- **Deletion job (C-I1, C-M-8).** Each request has its own `try/catch`; a failure adds to `attempts`, stores the error class in `last_error_code`, goes to `captureException` without the database message, and the run continues. Requests run in `attempts` order, then `verifiedAt`. The job no longer creates storage.
- **Rule 1 (B-I1).** Sessions cited by a missed-workouts flag that a coach resolved or dismissed (`resolved_by` set, closed within the window) no longer count. A flag resolved automatically (a late completion) hands its sessions back, because the rule may hold again on them.
- **Pauses (B-I2).** Not the upstream fix: `applyPause` still sets `paused` straight away (the coach UI and portal banner rely on it). `clientsInPauseNow` (an open pause whose `[start, resume)` covers today in the client's zone) decides instead, for check-in issuing and Rules 1 and 2.
- **Late start and finish (B-I3).** `OPEN_STATES` is unchanged, so an `incomplete` session stays in the past list rather than in "upcoming" forever. The portal home continues an `incomplete` workout started in the last 24 hours; older ones are finished from the workouts list.

Checks after `04ffe04` (cloud session, Linux, Node 24, Postgres 16): lint (0 errors, the 2 old warnings), typecheck, `format:check`, `pnpm test` (813 tests), `db:diff` clean. Browser tests: `pnpm test:e2e` 75 passed and 4 skipped (the 2 earlier failures and the new late-start/late-finish spec included), and the offline config 5 of 5 passed against a production build. They ran in this container with the preinstalled Chromium through a local Playwright config that is not committed.

## Uncommitted work

These 7 files are the round-2 offline fix for N1, M1 and the residuals. They are **not finished or verified**, so they are left uncommitted in the local worktree `D:\Gym-review` and are not in this push:

- `apps/web/e2e/offline.spec.ts`
- `apps/web/public/sw.js`
- `apps/web/src/components/nav/SignOutButton.tsx`
- `apps/web/src/portal/offline/db.ts`
- `apps/web/src/portal/offline/device.test.ts`
- `apps/web/src/portal/offline/outbox.ts`
- `apps/web/src/portal/offline/signOut.ts`

If you continue on another machine, re-implement round 2 from `rereview-F1.md` (N1, M1 and the residual fixes).

## Next steps

1. **Finish round 2 of fix group 1.** Then run the offline unit tests, `cd apps/web && npx playwright test -c playwright.offline.config.ts`, lint and typecheck. Get a scoped re-review against `rereview-F1.md`.
2. **Re-review fix group 2** (`4dfae04`, `ab90168`) against D-I1–I3 in `review-D-db.md`, and confirm `db:diff` is clean. That command is `pnpm --filter @kinetic/db db:diff` with `SHADOW_DATABASE_URL` set.
3. **Re-review fix group 3** (`2dca49d`) against C-I1–I3 and D-I4 in `review-C-sprint5.md` and `review-D-db.md`.
4. **Re-review fix group 4** (`04ffe04`) against B-I1–I4 in `review-B-sprint4.md`.
5. **Write `docs/pr-2-review-followups.md`** with the triaged Minor findings.
6. **Run the full checks:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm test:e2e`, plus the offline config. Everything must be green.
7. **Report back to the user** before merging. The user approves the merge.

Rules that still apply:

- Never force-push to `claude/sprint-3-wip-9t9dd0`; fetch before pushing.
- Stay off ports 3100 and 8181, the shared `kinetic` database, and `D:\Gym-preview`.
- E2E runs on ports 3200 and 8281, and the offline config on port 3300.
