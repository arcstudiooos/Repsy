# Sprint 3 — Follow-ups

Sprint 3 (Reliable workout experience) covers Tasks 3.1–3.9 of `docs/superpowers/plans/2026-10-30-sprint-3.md`. Tasks 3.1–3.5 were committed on branch `sprint-3`; Tasks 3.6–3.9 were completed on `claude/sprint-3-wip-9t9dd0`, which carries the whole sprint. This file records the planning rulings, deviations and what was knowingly deferred. The Sprint 0–2 follow-up files still apply where their items are not marked done below.

## Rulings made while planning

1. Only the client copy of a client's **active** assignment is editable; any other copy → 409 `CONFLICT` ("This program is no longer active for this client.").
2. A client copy keeps its days per week (it must equal the assignment's weekday count); changing it → 422 on `weeks`. Structural edits on client programs therefore add or remove whole weeks; day content and order can change freely.
3. Added slots are dated after the assignment's latest non-cancelled session (never before today in the client's zone), on the assignment's weekdays, in slot order. Removing a middle week leaves a gap; later sessions keep their dates.
4. Drafts are one per program, last write wins between tabs; conflicts are detected only at commit (`expectedVersion`).
5. A client's own edit within 24h also writes a `SetLogRevision` (reason optional). The coach's reason is shown to coaches only; the client sees "Corrected by your coach". A cleared set stays as an all-null row.
6. A pause starts today or later and lasts 1–90 days. Client status becomes `paused` when the pause is created; the `pauses.end` worker job (every 10 minutes) ends it on the resume date in the client's zone. Status changes to or from `paused` go through the pause API only (a PATCH gets 422 "Use Pause program to pause or resume.").

## Rulings made while building

- **Paused clients keep their slot** under `activeClientLimit` (`invited`, `active` and `paused` count). The automatic resume can't be refused, so a pause must not free a slot that the resume would then exceed.
- **Archiving a paused client** closes the open pause (`endedAt` = now); sessions stay where the pause put them. The worker only reactivates a client whose status is still `paused`.
- **Shift rule.** Every pause operation moves the client's `scheduled` sessions dated on or after `start + appliedOffsetDays` by the difference to the new offset. `resumeNow` never moves sessions further than the pause already did (a due pause the worker hasn't ended yet stays put) and, before the start date, restores the original dates.
- **Pause API responses** return the updated `ClientView` (with `pause`) and `meta.shifted`.
- **Outbox status codes.** 401, 429 and 5xx keep the writes and back off (1 s doubling to 60 s); the clock-skew 422 blocks the session's queue until "Retry"; any other 4xx moves the write to `rejected` and shows "Some changes couldn't be saved: {message}".
- **Finishing offline** stays on the finished workout ("Saved on device"); online, the logger waits for the outbox and then goes to History as before.
- **Service worker scope is `/portal`**, not `/portal/`: the portal home must be controlled too, because workout pages are reached by client-side navigation from it.

## Plan deviations (recorded, no action needed)

- **Offline E2E on a production build with seeded users.** `next dev` pages don't hydrate offline (the Turbopack dev runtime needs its HMR connection), so `offline.spec.ts` runs from `playwright.offline.config.ts` against `next build` + `next start` (port 3300, `.next-e2e-prod`), as Task 3.9 Step 3 allowed. A production server refuses `DISABLE_BREACHED_PASSWORD_CHECK`, and the breached-password check needs the network, so that spec seeds its coach and client in the database (`seedCoachWithClient`, real credential hashes) and signs in through the form instead of signing up. `pnpm test:e2e` runs both configs.
- **The service worker also caches every `/_next/static` asset referenced by a stored workout page**, not only those the current document loaded: a client-side navigation never loads the full asset set of the page it caches.
- `e2e/support/stack.ts` now removes its build dir on start (Sprint 2 tooling follow-up, done).
- The worker job registry gained `cron` (pg-boss `schedule`) for `pauses.end`.

## Done in Sprint 3 (from the Sprint 2 list)

- S3-3: "Saved on device", the IndexedDB outbox, the clock-skew 422 handling and the stale cached-payload restore (the logger renders the device's newest values).
- S3-4: `SetLogRevision`, the 24h client edit window and coach corrections.
- S3-2: sessions of removed slots are cancelled on commit.
- Tooling: the E2E stack clears `.next-e2e` on start.

## Sprint 4

- **S4-2 (missed sweep).** Lock the workout version when the sweep marks a session `missed`; decide whether a late offline sync after `missed` may still complete it (today it is a 409 and the outbox moves it to `rejected`, so the device's values are shown as not saved, never silently dropped).
- **S4-3 / S4-5.** Pause periods must be excluded from adherence (D-003); `client_pauses` has the dates. A timeline of corrections and pauses belongs to S4-5.

## Can wait (tracked, low risk)

- **Outbox across devices.** Two devices logging one session merge by `clientUpdatedAt` on the server (the stale ack updates the device copy). There is no multi-device merge UI (D-004 out of scope).
- **Rejected writes** stay listed on the workout until the device store is cleared; there is no "dismiss".
- **Pause history.** Ended pauses are kept but not shown anywhere yet.
- **Lint.** The two pre-existing `no-location-assign-relative-destination` warnings remain.

## Local tooling notes (this environment, not product issues)

- The container's Playwright browser build can differ from the one `@playwright/test` expects; point `launchOptions.executablePath` at the installed Chromium with a local config override rather than editing `playwright.config.ts`.
- Clear `apps/web/.next-e2e` before a local E2E run if a previous run was interrupted (the stack now does it on start).
