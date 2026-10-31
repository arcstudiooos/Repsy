# PR #2 review B: Sprint 4 (check-ins, messages, review engine and queue, notes and timeline)

Reviewer scope: commits de17e82, 3afd662 (S4-1), f2019bf (S4-4), 8d396a7 (S4-2), 4b205bb (S4-3), 0c4b688 (S4-5) in `D:\Gym-review` at 30b1cea. Requirements were checked against `docs/implementation-plan.md` S4-1..S4-5, `docs/decisions.md` (D-003, D-005, D-007, D-008, D-010), `docs/superpowers/plans/2026-10-30-sprint-4.md` and `docs/sprint-4-followups.md`. This review read the code only. No tests were run, and nothing in the checkout was modified.

## Strengths

- **Tenant schema is consistent.** All six new tables (`checkin_templates`, `checkins`, `conversation_threads`, `messages`, `review_flags`, `internal_notes`) have:
  - `organization_id`
  - composite `(fk, organization_id)` FKs to `clients`, templates and threads
  - `ENABLE` plus `FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy

  All six are added to `rls.test.ts` and `tenantIntegrity.test.ts`. Uniqueness is enforced in the database: `(client_id, period_local_date)`, `(organization_id, dedupe_key)`, `(thread_id, client_message_id)`, and one template per organization.

- **Client scoping is in core, not in the routes.**
  - `scopeFor` and `findCheckin` (checkins.ts:235-274) and `threadFor` (messages.ts:62-79) use the server-derived `actor.clientId`. Archived clients get no `clientId` (api.ts), so unknown IDs, other-client IDs and cross-organization IDs all return 404.
  - Coach-only reads (`listCheckins`, `listNotes`, `getClientTimeline`, `createFollowup`) check that the client exists under RLS first.
- **Messages are immutable at the database level.** The `messages_reject_edit` trigger allows only `read_at` to change, and `messages_body_check` limits the body to 1-4000 characters.
  - The `message.sent` audit row has no metadata.
  - The `new_message` email payload holds the sender name and a link only.
  - API error logging drops `err.message`.
  - `app_message_email_opt_in` limits the RLS bypass to one boolean for a member of the current organization.
- **Check-in submit is safe to retry.** It takes a row lock, replays the same idempotency key, and returns CONFLICT for a different key. Its audit is content-free (an answer count only). Drafts are hidden from coaches (checkins.ts:115). Questions are snapshotted per check-in.
- **Issuing is idempotent.** `createManyAndReturn` with `skipDuplicates` relies on the unique index, so concurrent sweeps create one row and enqueue one email. 06:00 and 23:59 are computed with the DST-correct `localTimeOn` / `localDayBounds`.
- **Rules engine:**
  - Missed sessions are locked to their slot version when marked.
  - Auto-resolve uses a null resolver.
  - Snooze expiry sets `reopenedAt`.
  - The Rule 2/3 hook runs inside the submit transaction (D-005).
  - The Pacific/Auckland 23:59 0h-grace boundary has a test.
  - Flag actions take a row lock, require a reason (422 without one) and are audited without the reason text.
- **Notes are never sent to clients.** The policies `note:read` and `note:write` are owner/coach only. Notes appear only in the coach `/app` notes and history pages and their routes. Edit and delete are author-only.
- **The review queue's optimistic list is reset correctly.** `FlagQueue` is keyed by filter, rule and flag IDs, so a server refresh re-seeds it and the optimistic state cannot go stale.

## Critical

None found. I found no cross-tenant or cross-client read or write path. I found no route, page or payload that sends internal notes to a client. I found no path that puts a message body in logs, audit rows or the email.

## Important

### I-1. After a coach resolves or dismisses a missed-workouts flag, new misses are not flagged for up to 7 days

**Where:** `packages/core/src/review/rules.ts:145-165`, together with `raiseFlag` (rules.ts:40-57).

**What happens:**

- The episode key is always the two _oldest_ missed sessions in the rolling window: `missed_workouts:{client}:{a}:{b}`.
- Once the coach resolves or dismisses that flag, the `open` guard no longer blocks it. The next sweep builds the same `a:b` key, and `createMany(skipDuplicates)` silently drops it.
- Example: the client misses `c` and `d` the next day. The window is `[a,b,c,d]`, the key is still `a:b`, so no flag is raised.
- A new flag appears only when `a` leaves the 7-day window (key becomes `b:c`). Even then it cites `b`, which the coach already handled.

**Why it matters:** Rule 1 (≥2 missed in 7 days) holds again on new evidence, but the coach gets no alert for up to a week. This is a missed alert in the core coaching loop.

**Related:** `messageUnreadRule` (rules.ts:213-231) has the same problem. If the coach resolves a `message_unread` flag without opening the thread, later unread client messages in that thread never raise a flag, because the key stays on the oldest unread message.

**Fix:** For Rule 1, drop sessions already cited in any closed `missed_workouts` flag's `evidence.sessionIds` before choosing the pair, then key on the remaining pair. Add a test: resolve, then 2 new misses, then a new flag. For Rule 4, key on the oldest unread message _newer than the last closed flag's message_ for that thread.

### I-2. A pause scheduled for a future date stops check-ins and missed-workout flags immediately

**Where:**

- `packages/core/src/review/rules.ts:137` (`client: { is: { status: 'active' } }`)
- `packages/core/src/checkins/checkins.ts:406` and `apps/worker/src/jobs/checkinsIssue.ts:18` (`status: 'active'`)
- Root cause: `packages/core/src/clients/pause.ts:177`, where `applyPause` sets `status: 'paused'` straight away, even when `startLocalDate` is weeks ahead.

**What happens:** Sessions before the pause start are not shifted (D-003), and `deriveSessionStates` still marks them `missed`. But Rule 1 ignores the client and no check-ins are issued until the pause _ends_.

**Why it matters:**

- D-003 says "no missed-workout flags generated for _paused time_".
- D-010 #3 says "No check-ins are issued _during a pause_".
- In practice, a coach who books a holiday pause 3 weeks out gets 3 weeks with no check-ins and no Needs-review, while the client may be missing workouts.
- The only test (`checkins.test.ts:90`) uses a pause that starts today.

**Fix:** Decide paused-ness from `client_pauses` date ranges, not `clients.status`:

- Rule 1: exclude sessions whose `scheduledLocalDate` falls inside a pause row, and do not exclude the client as a whole.
- Issuing: skip only when `today` is in `[startLocalDate, resumeLocalDate)` of an open pause.

The alternative fix is upstream: set `status = 'paused'` only when the start date arrives, using the worker that already ends pauses. Add a test with a future-dated pause.

### I-3. Late start and late finish are allowed by the API, but the portal gives no way to do them, and the sweep can hide an active workout

**Where:**

- `apps/web/src/components/workout/WorkoutLogger.tsx:425`: only `scheduled` shows **Start workout**.
- `WorkoutLogger.tsx:472`: anything other than `in_progress` renders the read-only finished view.
- `packages/core/src/sessions/types.ts:16`: `OPEN_STATES` is `scheduled` and `in_progress`.
- `apps/web/src/app/portal/page.tsx:80`: only `in_progress` shows **Continue workout**.
- The backend allows these actions: `lifecycle.ts:15,121` and `upsertSetLogs.ts:70`.

**What happens:** Plan Ruling 4 and the follow-ups doc say missed and incomplete sessions "can still be started or finished", and S4 changed core to allow it. The UI was not updated:

- A `missed` session cannot be started from the portal at all.
- An `in_progress` workout swept to `incomplete` drops out of "Continue workout". On reload it shows as finished, with no logging controls and no Finish button.

With grace hours set low (0h is allowed, D-008 #5), this hits a client training across midnight. The background outbox still syncs, but the user sees the workout closed.

**Fix:**

- Treat `incomplete` like `in_progress` in `WorkoutLogger`, portal home "Continue workout", `OPEN_STATES` and `applyDeviceView`'s `finishedHere`.
- Offer **Start workout** for `missed`.
- Add an E2E test: start, run the sweep past due plus grace, reload, finish.

### I-4. Each organization's sweep is one large interactive transaction, and one failure stops all later organizations

**Where:**

- `apps/worker/src/jobs/reviewSweep.ts:22-25` and `checkinsIssue.ts:25-28`: sequential loop with no per-organization `try/catch`.
- `packages/db/src/tenant.ts:269`: `$transaction` with the Prisma default 5 s timeout.
- `packages/core/src/review/rules.ts:105-120,148,213,255`: one or more queries per session, per client, per thread and per flag.

**What happens:**

- **Backlog never clears.** The first sweep after deploy must convert every past-due `scheduled` session left over from Sprints 2-3 to `missed`. Each one costs 2 lookups plus 1 update. For a pilot organization with a few hundred past sessions on a hosted database, this can exceed 5 s. The transaction rolls back, nothing commits, the backlog stays the same size, and every later sweep fails the same way.
- **One failure stops everyone.** The exception leaves the loop, so every organization after the failing one gets no derivation, no flags and no snooze reopen. Issuing check-ins has the same loop shape.

**Fix:**

- Wrap each organization in `try/catch` and log only `orgId` and the error name.
- Make derivation set-based, or chunk it into separate transactions. Missed: `UPDATE … WHERE state='scheduled' AND due_at < cutoff` with the slot version from a join. Incomplete is already one `updateMany`.
- Or pass an explicit `timeout` to the sweep's transaction.

I did not measure the timing. This is a credible risk, not an observed failure.

## Minor

- **M-1. A weekday change can skip a whole week.** `packages/core/src/checkins/checkins.ts:25,424-431`. The 6-day gap check means a change to an _earlier_ weekday after this week's issue (e.g. Wed → Mon) skips the next Monday, which is 5 days later. The next check-in comes 12-13 days after the last one. This matches Ruling 2's wording, but coaches may read it as a missed week. Fix: use `MIN_GAP_DAYS = 5`, or compare ISO week/period instead of a day gap. Or show "Next check-in: <date>" in `CheckinSchedule`.
- **M-2. Overdue flags are raised for paused clients.** `packages/core/src/review/rules.ts:180`. `checkin_overdue` excludes only archived clients. A check-in issued just before a pause starts raises an overdue flag during the pause, against D-010 #3 ("no overdue flags arise for paused time"). Fix: exclude check-ins whose due window ends inside a pause.
- **M-3. Invalid calendar dates return 500.** `packages/core/src/review/flags.ts:220-225,299-311`. `until` and `dueLocalDate` pass the `YYYY-MM-DD` regex only, so values like `2026-02-31` or `2026-13-01` reach `localTimeOn`. That throws `ScheduleInputError`, which is not a `DomainError`, so the API returns 500 instead of 422. Fix: validate a real date, or catch `ScheduleInputError` and turn it into `invalid(...)`.
- **M-4. Concurrent duplicate sends return 500.** `packages/core/src/messages/messages.ts:285-309`. The idempotent send is check-then-insert. Two concurrent sends with the same `clientMessageId` both miss the `findFirst`, and the loser hits the unique index (P2002 → 500). Fix: catch P2002 and return the stored message, or use `createMany(skipDuplicates)` and then re-read.
- **M-5. A draft save racing a submit returns 500.** `packages/core/src/checkins/checkins.ts:294-303`. The draft save takes no row lock. If it races a submit, its UPDATE breaks `checkins_submission_check` (draft must be null once submitted), giving 500 instead of 409. Fix: `updateMany({ where: { id, submittedAt: null } })` and return CONFLICT when the count is 0.
- **M-6. Polling marks messages read in background tabs.** `apps/web/src/components/messages/MessageThread.tsx:52-60`. The 15 s poll calls the first-page GET, which marks messages read (messages.ts:202-207). A portal or inbox tab left open in the background marks everything read, which undermines "read when the recipient views" and silences Rule 4. Fix: send `markRead=false` on polls, or skip polling while `document.visibilityState !== 'visible'`.
- **M-7. Read state is per message, not per recipient.** `packages/core/src/messages/messages.ts:203-206` and `rules.ts:217`.
  - An owner who is not the thread's coach marks the _coach's_ messages to the client as read when opening the thread.
  - Rule 4 treats any non-`coachUserId` sender as the client. A stale `coachUserId` after a coach reassignment makes this worse.
  - Low impact while R1 organizations have one coach. Fix: mark read only messages whose sender is the other party (client user, or thread coach). For Rule 4, filter `senderUserId = client.userId`.
- **M-8. Template renames change the title of issued check-ins.** `packages/core/src/checkins/checkins.ts:106` and `sessions/read.ts` (portal home). The title comes from the live `template.title`, while the questions are snapshotted. Fix: snapshot the title too, or accept it and document it.
- **M-9. A session whose slot is gone is retried forever.** `packages/core/src/review/rules.ts:107-113`. If the slot no longer exists, the session stays `scheduled` and is re-tried on every sweep (two queries each). The comment assumes another path cancels it. Fix: cancel it here, or log it once.
- **M-10. The portal notes test checks for strings, not a schema.** `apps/web/test/notes.int.test.ts:115-168`. It looks for one secret string and `/internal_?note/` in 5 API payloads. S4-5 asks for a schema test on portal responses. Server-rendered portal pages (home, `/portal/check-ins/[id]`, `/portal/messages`) and later portal APIs are not covered. Fix: assert the response keys against an allowlist schema (e.g. zod `.strict()`) for each portal route, and add the RSC pages through E2E text checks.
- **M-11. The coach dashboard runs 2 queries per thread.** `packages/core/src/messages/messages.ts:143-157` (`listThreads`) and `apps/web/src/app/app/page.tsx` (`unreadMessageCount`). Fine at 30 clients. Fix: one grouped query.
- **M-12. Flags for archived clients stay in the queue.** No code path closes open flags when a client is archived. Fix: auto-resolve on archive, or filter archived clients in `listFlags`.

## Declined to judge

- Sprint 5 commits (e81ce1d through 30b1cea): analytics, exports, deletion and pilot hardening are outside this scope. I did glance at the S4 route `track()` calls: `coach_message_sent` and `checkin_submitted` carry no body or answers.
- Running the suites (unit, integration, E2E) and measuring sweep duration (I-4) against a realistic data set. Not done under the read-only and no-shared-database rules.
- Whether `clients.status = 'paused'` being set at pause creation was an intended Sprint 3 ruling. I-2 is filed against S4 because the S4 rules depend on it.
- UX copy and accessibility of the new pages, beyond the functional gating in I-3.
