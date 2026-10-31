# Re-review F1: PR #2 review A, offline findings C1, I1, I2, I3

Fix commit `d186da3` on `pr2-review` (base `21a0de2`), checkout `D:\Gym-review`. I read `F1.diff` in three passes (sw.js, layout and SignOutButton; WorkoutLogger and PortalDevice; useSyncStatus and workoutCache), then read the full head versions of `db.ts`, `outbox.ts`, `signOut.ts`, `PortalDevice.tsx` and `sw.js`. No suites were re-run.

## Finding verdicts

- **C1 ✅ Fixed (core). One new Important issue: a wipe error fails open (N1).**
  - Owner binding: `db.ts:110-145` (`bindOwner`/`claim`) wipes data stores and `kinetic-pages-*` on a foreign or unknown owner.
  - Every data helper waits on `bound` (`db.ts:92-95`). The module starts unbound (`db.ts:86`), so nothing reads or sends before the layout binds.
  - `flushOnce` sends nothing without an owner (`outbox.ts:429`) and only the owner's own writes for the active org (`outbox.ts:113-116, 432`). `enqueue` re-checks the owner after binding (`outbox.ts:179-182`).
  - The layout binds before children (`portal/layout.tsx:52`).
  - Sign-out flushes (bounded to 5 s), counts, confirms and wipes (`signOut.ts:16-29`, `SignOutButton.tsx:34-52`). `wipeDevice` clears the stores, then deletes the DB and the page caches (`db.ts:151-170`).
  - The E2E covers the offline visitor after sign-out (`offline.spec.ts:220-261`).
- **I1 ✅ Fixed.**
  - Refusals keep their body and message (`outbox.ts:51-61, 325-337`).
  - `not_saved` and `rejectedRows` are reported (`outbox.ts:127-147`), and rows show the error (WorkoutLogger `shownStatus`).
  - A batch 422 or 409 is split write by write (`outbox.ts:375-393`).
  - A completion is held behind refused logs, with "Finish anyway" (`outbox.ts:398-401, 227-233`).
  - A refused finish is unmarked (`outbox.ts:407-410`), and `evict` keeps refused data (`workoutCache.ts` evict).
- **I2 ✅ Fixed.**
  - Writes are ordered by a stored `seq`, assigned in the same transaction (`db.ts:227-240`, `outbox.ts:110`).
  - A blocked item stops `logsBatch` and the session (`outbox.ts:295, 362, 439`).
  - `retryBlocked` re-stamps in queue order and ends at now (`outbox.ts:198-224`).
  - `applyLocal` replaces rather than applying newest-wins (`workoutCache.ts` `replaceLocal`).
- **I3 ✅ Fixed.**
  - `PortalDevice` starts a reference-counted loop for every portal page after binding (`PortalDevice.tsx:12-27`, `outbox.ts:497-524`).
  - `useSyncStatus` no longer starts its own loop.

## Checks requested

- **(a) Online serving:** OK, with one pre-existing edge (Minor M1).
  - Navigations are network-first. The cache is used only in `catch` (`sw.js:115-125`).
  - Redirects come back as `opaqueredirect`, and `!res.ok` is returned as is. A 401, 5xx or redirect is never replaced by a cached page. `/api` and RSC requests are untouched.
- **(b) Owner check versus flush on load:** OK.
  - `bound` is pending from module load, and every helper awaits it.
  - `flushOnce` returns before any read when there is no owner.
  - Effect order doesn't matter.
  - Stale-tab and in-flight edges are Minor (M2, M3).
- **(c) Confirm flow:**
  - "Stay signed in" and Escape close the dialog. Nothing traps the user on the normal path.
  - **Fail-open on error:** see N1.
- **(d) Per-item split:** OK.
  - Each write is resent in seq order. The upsert is keyed and LWW, so a resend can't duplicate a set.
  - An older edit can't beat a newer one.
  - A retry or block mid-split keeps the remaining writes in place.
  - The completion can't pass, because refused logs hold it (`outbox.ts:399`), and blocked or retried items return before it.
  - An ack of a later edit settles an earlier refusal of the same row (`outbox.ts:340-355`).
- **(e) Sign-out entry points:** covered.
  - Every UI sign-out uses `SignOutButton`: portal profile, `CoachNav`, coach `/app/more` and the invite page. `grep authClient.signOut` has no other caller.
  - Workspace switch (same user) keeps the data. That is correct: writes wait for their org.
  - Revoke-all keeps this device signed in, so not wiping is correct.
  - Password-reset revocation and expiry are the residual.
- **(f) Cache scope:** OK. The page deletes only `kinetic-pages-*` (`db.ts:19, 98-103`). The SW `activate` deletes only stale `kinetic-*` (`sw.js:24-26`). Asset caches are kept.

## New issues in the fix

### Critical

None.

### Important

**N1. Sign-out fails open: if `wipeDevice` errors, the page caches are not deleted and sign-out proceeds silently.**

- **Where:** `SignOutButton.tsx:36`, `db.ts:151-170`.
- **What:**
  - `wipeDevice().catch(() => undefined)` swallows any error.
  - Inside `wipeDevice`, `deletePageCaches()` runs only after the IndexedDB clear succeeds. A failing `openRaw` or `db.transaction` therefore skips the cache deletion. Examples are iOS Safari's "Connection to Indexed Database server lost", where the cached connection is dead, or an `InvalidStateError`.
  - The user is signed out, believing the device is clean. The previous user's `/portal` and workout pages stay servable offline. This is C1 again, on the target platform (gym iPads and phones).
  - Related: `start()` treats a failed count as 0 unsynced (`SignOutButton.tsx:45`). It then wipes without the "Sign out anyway?" warning.
  - Nothing bounds `wipeDevice` or the count in time. An `indexedDB.open` blocked by an old-version tab never settles, and the button stays disabled. In practice that is only during an upgrade.
- **Minimal fix:**
  1. In `wipeDevice`, wrap the IDB clear in `try/finally`.
  2. Always call `indexedDB.deleteDatabase(DB_NAME)`, which needs no open connection, and `deletePageCaches()`.
  3. Bound the IDB part with a timeout.
  4. In `SignOutButton`, if the page caches could not be deleted, show an error ("Couldn't clear this device. Try again.") instead of signing out silently.
  5. On a count error, show the confirm dialog rather than assuming 0.

### Minor

- **M1. A failed cache write online can serve the cached page.** This is pre-existing and not introduced by F1.
  - In `sw.js:115-125`, `wanted()` and `cache.put` sit inside the same `try` as `fetch`.
  - If the put throws (for example on quota), the `catch` serves the cached page instead of the fresh 200. That can be the previous user's `/portal` to a newly signed-in user, until `bindOwner` wipes it.
  - Fix: wrap the store step in its own `try {} catch {}` and always `return res`.
- **M2. A stale tab keeps its in-memory owner after another tab signs out.**
  - Tab 1 is still on A's portal while A signs out in tab 2 and B signs in.
  - Tab 1's `onversionchange` closes its connection but doesn't `unbind()` (`db.ts:44-47`).
  - Anything A types in tab 1 is queued with `userId` A into B's store. Tab 1 then sends it with B's cookie. The server refuses it (404), so nothing crosses on the server, but it breaks "never send another user's writes".
  - Fix: in `onversionchange`, when `event.newVersion === null`, call `unbind()`. Alternatively, have `flushOnce` compare the stored `meta.owner` with `currentOwner()`.
- **M3. A flush still in flight at wipe time hangs on the Web Lock.**
  - This happens when the 5-s timeout expires, or when the loop's pass is mid-send.
  - The flush's next `put` or `del` awaits the now-pending `bound` and hangs while holding the `kinetic-outbox` Web Lock. That stalls flushes in other tabs until this tab does a full navigation.
  - Login uses `window.location.assign`, so the hung pass dies there and never resumes under a new user.
  - Fix: on `wipeDevice`, reject `bound` (`failBound`) instead of leaving it pending forever, or re-check the owner after each `send`.
- **M4. `authClient.signOut()` failures are ignored** (`SignOutButton.tsx:37-39`).
  - When offline, the data is wiped, but the session cookie stays valid and the user is sent to `/login`.
  - If it throws, `busy` stays true until reload.
  - This is pre-existing behaviour. Surface the failure.
- **M5. The UI can stay "Completed" after a refused finish.** `finishRefused` requires `initial.session.state === 'in_progress'`. A finish refused in the same page view right after Start can therefore keep showing "Completed" (with the alert) until reload, if the page didn't remount on Start. This is low impact, because the alert is shown.

## Residuals verdict

1. **Session ends without sign-out (expiry, password-reset revocation) leaves pages and data servable offline.**
   - Acceptable for R1 as a Minor, documented user decision. The worker can't verify a session offline, and a full fix (lock screen or encrypted store) is out of R1 scope. Record it in `docs/decisions.md` under D-004.
   - Cheap hardening, recommended but not blocking: in `sw.js`, when an online `/portal*` navigation returns `opaqueredirect`, a redirect or a 401, delete `kinetic-pages-*`.
   - That closes the window as soon as the device is online once with the session gone. It also covers "sign out all other devices" and password-reset devices when they next come online.
2. **"Sign out all other devices" can't clear other devices.** Acceptable. It can't be fixed remotely, and the hardening above covers those devices on their next online portal visit.
3. **A page-cache write in flight after sign-out.** Minor. Fix: call `deletePageCaches()` once more after `authClient.signOut()` resolves. After that the cookie is gone, so any later SW `store()` gets a redirect and stores nothing.

## Assessment

**Needs another round.** It is small: N1 only, with the minimal fix above. Fold in M1 and M2 cheaply in the same round if convenient. C1, I1, I2 and I3 are otherwise fixed, and the residuals are acceptable for R1 with the decision recorded.
