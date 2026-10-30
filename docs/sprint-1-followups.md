# Sprint 1 — Follow-ups

Sprint 1 (Clients and basic programming) was completed on branch `sprint-1` (2026-10-30). The work covers Tasks 1.1–1.13, plus Task 1.6b (invite controls UI), which the controller added. Every task passed a task review. The whole branch passed a final review after one fix wave and one targeted time-zone fix. This file lists what was knowingly deferred. `docs/sprint-0-followups.md` still applies where its items are not marked done here.

## Must land first in Sprint 2 (first migration)

- **Composite tenant FKs for the remaining links.** These four are still single-column FKs: `workout_sessions.workout_version_id` (Sprint 2 writes it at session start), `programs.current_version_id`, `programs.source_program_id` and `programs.source_version_id`. Make them `(fk, organization_id)` composite FKs, the same way migration 000016 did the others.
- **Session sweep index.** Add an index on `workout_sessions (organization_id, state, due_at)` before the Sprint 2 and Sprint 4 portal queries and missed-session sweeps.

## Sprint 2 specifics

- **Portal "upcoming" queries.** Don't filter on `assignment.status = 'active'`. After a replacement, the ended assignment keeps its `scheduled` sessions that fall before the new start date. That is correct under D-010 #2.
- **`nextSession` in the assignment summary.** It hides an overdue `in_progress` session in favour of the next one. Show the in-progress session.
- **Lenient history reads.** `storedTargets` throws a plain `Error` on an unexpected top-level shape, which becomes a 500. Degrade to an empty list with a log instead, and keep only numeric fields.
- **Clean-up.**
  - Remove the unused `date-fns` dependency from core.
  - The add-client dialog parses the client limit out of the error message with a regex. Use `error.details` instead.
  - An empty client PATCH still updates and writes an audit event.
  - The client PATCH audit uses the raw URL id as `objectId`.
- **Golden-path E2E gaps.** These are not covered yet:
  - the programs-list "Assign" path
  - the server-side 422 readiness path
  - a 409 reached from the details step

## Sprint 3

- **S3-1 (drafts/history).** Show history from the lenient read path (above).
- **S3-2 (structural edits).** The unique index on `(assignment_id, slot_week_index, slot_day_index)` means a re-added slot must revive the cancelled session row rather than insert a new one. Only templates can be edited today (client copies return 404). S3-2 decides how client-program edits reconcile sessions.
- **S3-6 (builder ergonomics).**
  - Add UI for day notes, exercise notes, tempo and remove-week. These values are preserved but can't be edited.
  - Ask for confirmation before "fewer days" drops content.
  - Warn that Reload discards edits.
  - Map server `fieldErrors.weeks` to the fields they belong to.
  - The lb max on the load input uses ceil and should use floor.
  - The exercise picker needs a stale-search guard.
  - Run an axe check on dialogs in their open and validation states.

## Sprint 4

- **S4-2 (rules).** Add the `(org, state, due_at)` index if Sprint 2 didn't. A blank grace-hours value is rejected now, so no action is needed there.

## Sprint 5

- **S5-3 (deletion, admin).**
  - The immutability triggers have no exemption. Design a sanctioned, owner-only erasure path for lawful deletion (D-008 #16).
  - `programs → clients` is `ON DELETE RESTRICT`, so client copies must be handled before a client can be deleted.
  - A tenant transaction can update the user's own row, including `isPlatformAdmin`. Restrict which columns it can write before `/admin` ships.
  - Archiving a client should also revoke open invites. Today, archived→invited makes a pre-archive invite usable again.

## Before the first deploy

- **Worker email base URL.** `apps/worker/src/jobs/emailDeliver.ts` falls back to `http://localhost:3000`. It must throw when `NODE_ENV=production`.
- **Invite login link.** The token appears in a second URL, `/login?next=/invite/<token>`. Review whether that's acceptable.
- **Sprint 0 list.** The Sprint 0 "Before the first deploy" items still apply.

## Can wait (tracked, low risk)

- **db/RLS.**
  - A malformed `app.org_id` raises 22P02.
  - With bypass on, a garbage org id can still raise.
  - No test asserts that the users policies use `app_current_org()`.
  - The search_path test doesn't plant a real shadow function.
  - The tenant guard allows an unknown model, and `having` is untested.
  - The guard reads Prisma's private `_runtimeDataModel` and fails closed if it's missing.
- **Clients and invites.**
  - No P2002 → EMAIL_TAKEN mapping (the org lock already serializes creates).
  - The create casts hide missing fields; a typed `tenantCreate` helper would fix this.
  - Revoke and resend can race, and there is no partial unique index on open invites.
  - A verification email can still be sent late or stray.
  - `deleteUser` loses the original error on its third failure.
  - Email editing must revoke pending invites when it lands.
- **UI polish.**
  - The roster search can race with a stale `q`.
  - On the exercise library, filters can race and unknown filter values show "All".
  - A not-found page returns 200.
  - A bad cursor gives no first-page link.
  - Date formats are inconsistent (en-GB vs the browser locale).
  - The InviteControls busy guard uses state instead of a ref.
  - `collectPages` has no repeated-cursor guard, and exactly 200 results shows the capped hint.
  - `startDate` goes stale if the page stays open across midnight.
- **Scheduling.** In a DST gap that isn't at midnight and spans 23:59, the due time is off by the gap. No real zone hits this.
- **Tests and tooling.**
  - The E2E `resetRateLimits()` deletes rate-limit rows globally.
  - Some E2E waits were raised to 30s for cold compiles.
  - The race test for invite accept vs resend is a smoke test only.
  - The 26th-option select test is not a UI test.
