# Fix F1: PR #2 review A, offline findings C1, I1, I2, I3

Worktree `D:\Gym-review`, branch `pr2-review`. One local commit, not pushed:

- `d186da3` fix(portal-offline): bind device data to the user, clear it on sign-out, keep refused writes (PR #2 review C1, I1-I3)

Files: `apps/web/src/portal/offline/{db,outbox,workoutCache,useSyncStatus}.ts`, new `PortalDevice.tsx` and `signOut.ts`, `apps/web/src/components/nav/SignOutButton.tsx`, `apps/web/src/components/workout/WorkoutLogger.tsx`, `apps/web/src/app/portal/layout.tsx`, `apps/web/public/sw.js`. Tests: `outbox.test.ts`, new `device.test.ts`, `test-helpers.ts` and `apps/web/e2e/offline.spec.ts`.

## C1 (Critical): sign-out leaves another user's data on the device

**Design.** The design is documented in the headers of `sw.js` and `db.ts` and in the `SignOutButton` doc comment.

- **The store has an owner.** IndexedDB moves to v2, which adds a `meta` store holding the owner `{userId, orgId}` and the queue sequence. v1 data has no owner and v1 never shipped, so the upgrade drops it.
  - `bindOwner(owner)` claims the store. If the store holds data from a different user, or data with no known owner, it clears every data store and deletes the `kinetic-pages-*` caches first. Build assets hold no user data and are kept.
  - A different org for the same user keeps its data.
  - Every data helper (`openDb`) waits until the store is bound. Nothing reads the store before the owner check has run.
- **The portal layout binds the store.** `ClientGate` renders `<PortalDevice userId orgId>` before `{children}`. The ids come from `withServerTenant`'s actor. `PortalDevice` binds the store and then starts the sync loop (see I3).
- **Writes carry their owner.** Each outbox and rejected record stores `userId` and `orgId`. `flushOnce` and `syncState` only use records owned by the current user for the active org.
  - With no owner bound (before binding, or after sign-out), `flushOnce` sends nothing and opens nothing.
  - Another user's queued writes are never sent.
  - Another org's writes wait until that org is active again. So switching orgs no longer loses them.
- **Sign-out clears the device.** All sign-out paths use `SignOutButton`: the portal profile, the coach nav, the coach "More" page and the invite page. It now works like this:
  1. `unsyncedBeforeSignOut()` flushes first, bounded to 5 s so a hanging network can't stall it. It then counts outbox and rejected items.
  2. If anything is still unsynced, a dialog asks "Sign out anyway?" with the text "You have workout changes that haven't synced yet. If you sign out now, they're deleted from this device." The buttons are "Stay signed in" and "Sign out anyway".
  3. `wipeDevice()` clears every store, deletes the `kinetic-offline` database and deletes the `kinetic-pages-*` caches. It also unbinds the tab. A delete blocked by another tab still leaves the data cleared, and that tab's `onversionchange` closes its connection.
  4. `authClient.signOut()` runs, then the redirect.
- **The service worker is unchanged in behaviour.** It still goes network-first and serves a cached page only when the network fails. It now validates `sessionId` in the `cache-workout` and `uncache-workout` messages (the hardening from the Minor list).

**Tests**

- Unit tests in `device.test.ts` (8 tests):
  - Another user's sign-in wipes the workouts, queue and page caches. Asset caches are kept.
  - The same user keeps their unsynced writes.
  - Another user's queued write is never sent, and another org's write waits for its org.
  - `wipeDevice` deletes the DB and page caches, and nothing reopens the DB afterwards.
  - Sign-out counts:
    - a flush first, leaving 0;
    - 1 left when offline;
    - refused items included;
    - no owner bound (coach shell);
    - a hanging network bounded by the timeout.
- E2E in `offline.spec.ts`, "sign-out deletes the device's workout data; offline, the next visitor sees none of it (C1)":
  1. Client A starts a workout and logs a set offline. The logs API is then blocked, so the set stays unsynced.
  2. A signs out from the profile page. The test checks the dialog text, then "Stay signed in" (A stays on the profile page), then "Sign out anyway", which lands on `/login`.
  3. No cache holds the workout page or `/portal`, and `indexedDB.databases()` no longer lists `kinetic-offline`.
  4. Offline, a signed-out visitor opens the workout URL and `/portal` and sees neither the exercise nor the program name.
- **RED:** The `device.test.ts` sign-out tests failed ("not implemented", plus the foreign-write test sent 1 item). The owner-binding and wipe unit tests were written after `db.ts`, so they passed on their first run; they don't have a recorded RED. The E2E against the old `SignOutButton` failed at the confirm dialog ("element(s) not found", `offline.spec.ts:245`).
- **GREEN:** all of the above pass.

## I1: refused writes show as "Synced" and lose their values

- **Refused writes are kept.** `RejectedMutation` keeps `body` (the values) and the server's `message`.
- **`SyncState` reports refusals.** It gains:
  - `status: 'not_saved'`, shown as "Not saved" in red, whenever anything for the session was refused;
  - `rejectedRows` (row key to message);
  - `held`;
  - `rejected[].kind`.

  "Synced" now means nothing is queued and nothing was refused.

- **Rows show the refusal.** In `WorkoutLogger`, `shownStatus` shows a refused row as the existing `error` state ("Not synced. {message}") with Retry. Retry resends the unchanged draft for a refused row.
- **A fixed set clears its refusal.** An acknowledged ack (saved or stale) for that row removes it from `rejected`. A new finish replaces an earlier refused finish.
- **A refused batch is split.** If a merged logs batch gets a non-clock 422 or 409, `flushSession` resends it one write at a time. Only the bad write is refused.
- **A completion waits for its logs.** A complete or skip is not sent while the session has refused logs. The panel shows the held reason with "Keep editing" (`cancelFinish`: drops the queued finish and clears `finished` locally, so the logger reopens) and "Finish anyway" (`releaseHeld`: sends it with `force`).
- **A refused completion reopens the workout.** It calls `unmarkFinished`, and the logger shows the session as in progress again with "Your workout couldn't be finished: {message}".
- **Refusals can be dismissed, and are never silently evicted.** A "Dismiss" action (`dismissRejected`) clears a refusal the client has read. `evict` keeps a workout that has refused writes.
- **Tests (`outbox.test.ts`):**
  - The 409 test is updated: the session reads `not_saved` and the body is kept.
  - New tests cover:
    - a batch 422 split by item (2 sent, 1 refused, `rejectedRows`);
    - a completion held and then "Finish anyway";
    - Keep editing;
    - fixing the set and finishing again;
    - dismissing, which releases the completion;
    - a refused completion clearing `finished`;
    - finishing again replacing the old refusal.
- **RED:** "expected status synced to match not_saved", "sent 0 vs 2", "['logs','complete'] vs ['logs']", "cancelFinish is not a function", "'completed' to be undefined", and the re-finish test (one stale refusal left). **GREEN:** all pass.

## I2: clock-skew Retry, queue order and blocked items

- **The queue has a sequence.** `putInQueue` gives each item a stored, monotonic `seq` from `meta`, in the same transaction as the write, so two tabs never share a number. Re-enqueuing the same id keeps its seq. The queue is ordered by `seq`, never by `Date.now()`.
- **A blocked item holds back the rest.** `flushSession` stops at any item with `blockedReason`, and `logsBatch` never merges past one. A blocked item holds back every later item of its session.
- **Retry re-stamps the queue.** `retryBlocked` re-stamps every queued set of the session in queue order, ending at the corrected `now` (1 ms apart). The server accepts them, and the later edit of a set still wins, because queue order is typing order. The device copy follows (`replaceLocal`).
- **Typed values replace the device copy.** `applyLocal` now replaces the device's value for a typed set instead of applying newest-wins. A value typed while the clock is wrong still beats the skewed older one locally.
- **Tests:**
  - The clock test now uses a server that checks the timestamp: it refuses anything stamped more than 5 minutes past T0, replacing the old `skewed` flag. The device logs a day ahead, the clock is fixed, Retry is tapped, and the sets sync with stamps of T0 or earlier.
  - A Complete tapped after fixing the clock waits for the blocked logs. The order is logs, logs, complete.
  - A blocked middle item stops the later logs and the completion.
  - A correction typed after the fix wins on the server and in `localView`.
- **RED:** "expected 1793880000000 <= 1793793600000", "['logs','complete','logs'] vs ['logs']", "['logs','complete'] vs ['logs']", "[[0,8]] vs [[0,9]]". **GREEN:** all pass.

## I3: sync only while a workout page is open

- **The layout runs the loop.** `PortalDevice`, rendered by the portal layout for every portal page, starts `startSyncLoop()` after binding. `useSyncStatus` no longer starts its own loop. `startSyncLoop` is reference-counted, so the tab never runs more than one loop.
- **E2E:** "a workout finished offline syncs from the portal home, without reopening it (I3)". The client completes a workout offline, goes to `/portal` (from the cache), and comes back online. The server's session state becomes `completed` with 1 row while the page stays on `/portal`.
- **RED:** with the loop disabled in `PortalDevice` and the old `useSyncStatus` (loop only on the workout page), the session stayed `in_progress` (poll at `offline.spec.ts:212`). **GREEN:** passes.

## Commands and results (in `D:\Gym-review`)

- `pnpm exec vitest run apps/web`: 45 files, **275 passed**. The offline files alone have 26 tests; there were 8 before.
- `pnpm lint`: 0 errors. The 2 warnings are pre-existing (`AcceptForm.tsx`, `OrgChoices.tsx`).
- `pnpm typecheck`: passes.
- `prettier --check` on the touched files: clean.
- `npx playwright test -c playwright.offline.config.ts`: **5 passed**. This is the prod build on port 3300, worker port 8281, with its own embedded DB. The default config ignores `offline.spec.ts`, so this spec must run with this config.
  - The first run failed in the existing "uncached session" test at sign-in ("Email or password is incorrect"). That message is how the login form shows Better Auth's sign-in rate limit, which was hit because the new fast tests sign in back to back. `coachAndClient` now calls `resetRateLimits()`.
- `rm -rf .next-e2e && npx playwright test workout-logging golden-path portal settings workspace-switch`: **15 passed** on ports 3200/8281. `settings` and `workspace-switch` were added because they click Sign out.
- The RED E2E runs swapped in the old code temporarily. Every file was restored and checked with `cmp` against the saved copies before committing.

## Residual risks

- **A session that ends without sign-out leaves its pages.** If A's session expires, or A never signs out, A's cached pages and data stay on the device. An offline visitor can still open them, because the worker can't verify a session offline (the cookie is HttpOnly). The next online portal load by a different user wipes them. The fix covers deliberate sign-out and a user change, as the brief allowed. A complete fix would need something like an encrypted store or a lock screen.
- **"Sign out of all other devices" doesn't reach other devices' data.** It keeps this device signed in, so nothing is cleared here; that is correct. The other devices can't be reached remotely: their data stays until a different user loads the portal there, or the same user signs out. A password reset that revokes sessions behaves the same way.
- **An in-flight cache write can land after sign-out.** A service-worker `store()` started just before sign-out (Start, then immediately sign out) could finish after `wipeDevice` and leave one page cached. The SW registration is also kept; it serves nothing once its page caches are empty.
- **Finishing is still allowed with refused rows.** The Finish button doesn't block on refused rows: the completion is held and surfaced instead. A refused row is resent through Retry or by editing it.
- **No React component tests.** `vitest` only includes `*.test.ts` and has no jsdom, so the `WorkoutLogger` and `SignOutButton` UI paths (held completion, Keep editing, Not saved rows) are covered by the outbox unit tests and the C1 E2E only. Keep editing, Finish anyway and Dismiss have no E2E.
- **Splitting is per write, not per set.** A single queued write with several sets is not split further. `WorkoutLogger` always queues one set per write, so this doesn't happen today.
- **Other tabs still update late.** Status notifications across tabs (the Minor finding about `BroadcastChannel`) were not changed.
