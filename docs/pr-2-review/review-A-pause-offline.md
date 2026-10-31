# PR #2 review A: pause/resume (S3-5) and offline continuity (S3-3)

Scope: f6ec0a8, 5524dcc, 44f5ed9, fe096ef (checkout `D:\Gym-review` at 30b1cea). Line numbers refer to HEAD (30b1cea). Requirements: sprint-3 plan Tasks 3.6–3.9, Global Constraints, Ruling 6, D-003, D-004, `docs/sprint-3-followups.md`.

## Strengths

- **Pause shift math is sound and idempotent.** Every operation shifts `scheduled` sessions from `start + appliedOffsetDays` by `target - applied`. A replay with the same dates, a repeated PATCH to the same date, a shortened resume date and an early resume (before or after the start) can't move a session twice. `resumeNow` clamps to `min(applied, max(0, today - start))`, so a due pause the worker hasn't ended yet stays where it is (`packages/core/src/clients/pause.ts:96-121, 205-211, 245-251`).
- **Each move recomputes the local day bounds** with `localDayBounds(date, assignment.timezone)`. A test covers the America/New_York DST case (`pause.test.ts:115`). Completed, in-progress, skipped and missed sessions never move.
- **The client row is locked before anything else** in every pause operation (`lockClient`). `updateClient` uses the same lock order before it closes the pause on archive.
- **Schema is correct.** The partial unique index allows one open pause per client. CHECK constraints hold `resume > start`, the 90-day limit and `applied_offset_days` within 0..90. The composite `(client_id, organization_id)` FK and ENABLE + FORCE RLS are in place (`migration.sql`). `rls.test`/`tenantIntegrity.test` are extended.
- **The worker scans with `withSystem` (read only)** and ends each pause in `withTenant(p.organizationId)`. `endDuePause` re-checks under the client lock. It writes nothing across tenants and moves no sessions (`apps/worker/src/jobs/pausesEnd.ts:16-45`).
- **The pause API returns 404 across orgs** (the lock `updateMany` under RLS matches 0 rows) and 403 for client actors. PATCH status to or from `paused` returns 422 with the verbatim copy.
- **Paused clients keep their slot** under the client limit. This is a sensible ruling that is documented.
- **The service worker leaves `/api/*` and RSC requests alone.** It is network-first for navigations and caches only `res.ok && !res.redirected` responses. Navigation redirects come back as `opaqueredirect`, so a sign-in redirect is never stored. `/sw.js` is outside the proxy matcher, so it is public, and it is served with `Cache-Control: no-cache`.
- **Outbox idempotency holds.** Logs replay against the `(session, exercise, setIndex)` upsert with `clientUpdatedAt` LWW. Complete and skip carry a persisted idempotency key. Flushes are serialized in the tab and across tabs via `navigator.locks`. The E2E test asserts one completion audit and one row per set after an offline round trip.

## Critical

### C1. Sign-out leaves the previous user's portal pages, workout data and unsynced writes on the device: cross-user exposure and data loss

- **Where:** `apps/web/public/sw.js:30-34, 99-118`; `apps/web/src/components/nav/SignOutButton.tsx:21-26`; `apps/web/src/portal/offline/db.ts:6`; `apps/web/src/portal/offline/outbox.ts:158, 213-222, 237-256`.
- **What:** Nothing clears Cache Storage (`kinetic-pages-v1`), the IndexedDB database `kinetic-offline` (`workouts`, `outbox`, `rejected`) or the service worker registration on sign-out. The codebase never calls `caches.delete`, `indexedDB.deleteDatabase` or `unregister`, and sends no `Clear-Site-Data`. Cache keys are bare paths (`/portal`, `/portal/workouts/{id}`) with no user binding. `wanted('/portal')` is always true, so every online portal-home visit stores the full HTML of that user's home page.
  1. **Exposure.** User A signs out on a shared device (family tablet, gym iPad). Anyone who then opens `/portal` or `/portal/workouts/{A's id}` while the network is down gets A's cached HTML back from `caches.match`. The URL can come from browser history. A's name, coach org, next workouts and the full workout are exposed, and the logger overlays A's logged sets from IndexedDB (`localView`). This works for a signed-out visitor and for a different signed-in user B.
  2. **Data loss.** A's queued writes stay in the global outbox. `flushOnce` sends every session in the outbox, not just the current user's. A's items get 401 while signed out, which is retried. Then B signs in and opens any workout page, which starts the loop. A's items now go out with B's cookie, get 404 and are moved to `rejected`, which keeps no body, and are deleted. A's unsynced workout is gone. Switching the active org has the same result for a client in two orgs.
- **Why it matters:** This is cross-user exposure of health and training data, and permanent loss of logged workouts. D-004 calls for a "minimal" cache, not one that outlives the session.
- **Fix:**
  - In `SignOutButton` (and any other sign-out path, such as password reset or account deletion), first `await flush()`.
  - If anything is still pending, confirm with "N workout changes haven't synced and will be lost".
  - Then delete every `kinetic-pages-*` cache (from the page via `caches`, or via a SW `clear` message), call `indexedDB.deleteDatabase('kinetic-offline')`, and optionally unregister the SW.
  - Also stamp each outbox/workouts record with `userId` and `orgId`. Expose the actor to the portal (for example a data attribute from the portal layout), and have `flushOnce`/`localView` skip records that don't match the current actor instead of sending them under someone else's session.
  - Add a test: sign out, go offline, open `/portal`, and expect no prior-user content.

## Important

### I1. Rejected writes show as "Synced", lose their values, and a rejected logs batch is followed by the completion

- **Where:** `apps/web/src/portal/offline/outbox.ts:74, 170-186, 213-231`; `apps/web/src/components/workout/WorkoutLogger.tsx:271-274, 335-342, 349`; the test `outbox.test.ts:128-139` asserts `status: 'synced'` after a 409.
- **What:**
  - `syncState` reports `synced` whenever the outbox is empty. A rejected item is deleted from the outbox, so the panel says "Synced". The row also drops out of `pendingRows`, and `applyDeviceView` marks device rows `synced`, so each rejected set row also reads "Synced". This contradicts D-004 #6 and the follow-ups doc ("the device's values are shown as not saved").
  - `RejectedMutation` keeps no body, so the values can't be retried or recovered. `evict` later deletes the local copy once the outbox is empty and the session is finished.
  - `logsBatch` merges up to 100 sets from many mutations into one POST. One invalid item (any non-clock 422) rejects all of them.
  - `flushSession` then goes on to send the session's `complete`, so the server finalizes the workout without those sets.
  - A rejected `complete` leaves the device copy marked `finished` (`markFinished` runs before enqueue), so the screen shows "Completed" with no way to finish again.
- **Why it matters:** The UI claims cloud sync for data the server refused, then silently discards it. This is exactly what D-004 #5/#6 forbid.
- **Fix:**
  - Compute `synced` only when both the outbox and `rejected` are empty for the session (or add a distinct "Not saved" state).
  - Add `rejectedRows` to `SyncState` and show those rows as "Not saved".
  - Store the body in `rejected` and offer retry or copy.
  - After a logs rejection, stop the session's queue before `complete`, or require an explicit "Finish anyway".
  - On a batch 422 that is not clock skew, resend the items one at a time (or bisect) so only the bad set is rejected.
  - Clear `finished` locally when a `complete`/`skip` is rejected.

### I2. Clock-skew "Retry" can never succeed, and fixing the clock reorders the queue so the completion goes out before the logs

- **Where:** `apps/web/src/portal/offline/outbox.ts:111, 119-130, 188-200, 245-247`; `apps/web/src/portal/offline/workoutCache.ts:31-37`; `WorkoutLogger.tsx:193`.
- **What:**
  - **Retry fails.** `retryBlocked` only clears `blockedReason`. The stored items keep the skewed `clientUpdatedAt`. The server compares that stored value with `now + 5 min` (`upsertSetLogs.ts:32`), so after the user "fixes the date and time, then taps Retry" as instructed, the same 422 comes back. The queue stays blocked until real time catches up with the skewed timestamp, which can be hours or days.
  - **Corrections lose.** The future-stamped values also win LWW against corrections typed after the clock is fixed, both locally (`newest`) and in `logsBatch`.
  - **Queue reorders.** FIFO order uses `createdAt = Date.now()`. A Complete tapped after the clock is fixed sorts before the earlier, future-dated logs. `flushOnce` checks only the head (now the unblocked complete), and `flushSession` never checks `blockedReason` on later items. So the server completes the session first, and the logs are blocked again or arrive later as post-completion edits.
- **Why it matters:** The documented recovery path doesn't work, and the "logs before complete" guarantee breaks in the very scenario the 422 exists for. The unit test passes only because its stub flips `skewed` instead of checking the timestamp.
- **Fix:**
  - On `retryBlocked`, re-stamp each blocked item's `clientUpdatedAt` to `new Date().toISOString()`. Do the same for the matching `workouts.local` entries.
  - Order the queue by a monotonic sequence (an IndexedDB autoIncrement key or a per-session counter), not wall-clock time.
  - Have `flushSession` stop at any item with `blockedReason`.
  - Make the test's server reject based on `clientUpdatedAt`.

### I3. Queued writes sync only while a portal workout page is open, not "automatically when connectivity returns"

- **Where:** `apps/web/src/portal/offline/useSyncStatus.ts:8-18` (the only caller of `startSyncLoop`); `WorkoutLogger.tsx:117`; `apps/web/src/portal/offline/ServiceWorker.tsx`.
- **What:** The flush loop (online, visibility change and 15 s) runs only while a client-mode `WorkoutLogger` is mounted. A client who finishes offline sees "Saved on device", then moves to Home or closes the app. Later they open `/portal` online. Nothing is sent until they happen to reopen a workout page. Meanwhile the coach sees the session in progress, and the S4 sweep/review flags act on stale state.
- **Why it matters:** D-004 #4 requires automatic sync. The E2E test passes only because it reopens the workout URL.
- **Fix:** Start `startSyncLoop()` once in the portal layout (for example inside the `ServiceWorker` component, guarded by `hasDeviceStore`). Optionally add SW Background Sync where it is supported.

## Minor

- **`apps/web/src/app/portal/page.tsx:30`, `portal/workouts/page.tsx:76`, `PausedBanner.tsx:13-24`.** A pause scheduled to start in the future shows "Program paused. Expected back on …" right away, while the client still has workouts due before the start. The client list shows "Paused" too, per Ruling 6. Users will find this confusing. Fix: when `startLocalDate > today`, show "Program pauses on {start}, back on {resume}", or add the start date to the banner.
- **`apps/worker/src/jobs/pausesEnd.ts:33-43`.** One throwing `endDuePause` (bad zone data, a lock timeout) aborts the loop, so later due pauses in the same run aren't ended until the retry succeeds. A persistent failure blocks them all. Fix: wrap each item in try/catch, report it, and continue.
- **`packages/core/src/clients/pause.ts:240`.** A replayed "Resume now" (a network retry after a lost response) returns 404 "isn't paused" instead of an idempotent success. The UI disables the button, so this is low risk. Consider returning `{ shifted: 0 }` when the latest pause ended within the last few seconds, or document the 404.
- **`pause.ts:107-119`.** Each shifted session is a separate `UPDATE` (N+1) inside the lock. A long program on a 90-day pause can mean hundreds of statements in one transaction. A single `UPDATE … FROM` with SQL date arithmetic would work, but bounds need the zone, so batching via `Promise.all` is acceptable.
- **`pause.ts:109`.** Bounds use `assignment.timezone`, while "today" and D-003 rule 3 use the client's zone. They only diverge if the client's zone changes after assignment. Note this in the follow-ups.
- **`apps/web/public/sw.js:25, 61-73`.** The `cache-workout`/`uncache-workout` messages don't validate `sessionId`. `workoutPath('../../x')` normalizes to another same-origin path, which then gets fetched and stored. Only same-origin controlled pages can post, so this is hardening. Fix: check it against `/^[0-9a-f-]{36}$/i` as `isWorkoutPage` does.
- **`sw.js:8, 85-95`.** `VERSION` is a constant, so the `kinetic-assets-v1` cache grows with every deploy and is never pruned. Workout pages that are never reopened are never evicted, so data lingers. Fix: put the build ID in the cache name (or prune assets that no stored page references on activate), and cap or expire stored workout pages, for example by age or once finished.
- **`outbox.ts:83-88`.** Status listeners are per tab. A flush in another tab never notifies this tab, so it keeps "Saved on device" until its own flush finds that session's items. A session with an empty outbox triggers no `notify`, so the stale label can last indefinitely. Fix: use a `BroadcastChannel('kinetic-outbox')` to notify after each flush.
- **`outbox.ts:158`.** A 401 retries forever with a 60 s backoff and no message. A signed-out client sees "Saved on device"/"Syncing" with no hint to sign in. Fix: surface "Sign in to sync your workout".
- **`outbox.test.ts:128-139`.** The test locks in the "synced after rejection" behavior (see I1). Update it together with the fix.

## Declined to judge

- How S4's missed/adherence code treats pause windows: those commits are outside this review's scope.
- Whether hidden coach roles lack `client:update`: the policy table wasn't changed in these commits.
- Real-device behavior of iOS Safari's SW/IndexedDB eviction (7-day storage cap): needs device testing.
- `localDayBounds` correctness beyond the DST test: it predates this PR.
