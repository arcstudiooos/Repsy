# Sprint 2 — Follow-ups

Sprint 2 (First end-to-end loop) was completed on branch `sprint-2` (2026-10-30). It covers Tasks 2.1–2.9 of `docs/superpowers/plans/2026-10-30-sprint-2.md`. Every task passed a task review; findings were fixed and re-reviewed. The whole branch then passed a final review. This file lists what was knowingly deferred. `docs/sprint-0-followups.md` and `docs/sprint-1-followups.md` still apply where their items are not marked done below.

## Done in Sprint 2 (from the Sprint 1 list)

- Composite tenant FKs for `workout_sessions.workout_version_id`, `programs.current_version_id`, `source_program_id` and `source_version_id` (migration 000017), plus the `(organization_id, state, due_at)` session index.
- Portal "upcoming" reads don't filter on the assignment status.
- `nextSession` shows an overdue in-progress session first.
- Lenient history reads (`readStoredTargets`).
- Clean-ups: `date-fns` removed from core; the add-client dialog reads `error.details.limit`; an empty client PATCH writes nothing; the PATCH audit uses the stored id.
- Golden-path E2E gaps: the Programs-list "Assign" path, the server-side 422 readiness path, and a 409 reached from the details step.
- Portal sign-out (Sprint 0 list) was already closed by Task 1.7.

## Plan deviations (recorded, no action needed)

- The coach "logged by coach" marking and its audit landed in Task 2.5's lifecycle code (with its tests); Task 2.7 added the coach UI.
- The shared E2E journey helpers (`e2e/helpers/journey.ts`) arrived in Task 2.4 instead of 2.9.
- Session routes live in `apps/web/src/server/routes/workoutSessions.ts` (`routes/sessions.ts` already held revoke-all).
- The portal list pages with "Next page" and "First page" links instead of an appending "Load more".
- Migration 000019 adds a trigger that makes a set `workout_sessions.workout_version_id` immutable (review finding on Task 2.5); review is migration 000020.

## Sprint 3

- **S3-3 (offline continuity).**
  - The workout screen is online only. Status words are "Syncing"/"Synced"; "Saved on device" arrives with the IndexedDB outbox and service worker.
  - A device clock more than 5 minutes ahead gets a 422 for its whole batch. The outbox must keep those items and show the message, not retry forever or drop them.
  - Navigating back to a cached workout page can restore an older in-progress payload (React Activity keeps the instance; the `key` only helps when fresh props arrive). Consider `router.refresh()` on mount, or rely on the outbox's local state.
- **S3-4 (log edits).** Set logs can only be written while a session is `in_progress` (enforced in core, not by a DB trigger). Editing after submission (24h window) and coach corrections need `SetLogRevision`. A cleared set is stored as an all-null row (hidden in the finished summary); decide whether edits delete rows.
- **S3-2 (structural edits).** An unstarted session whose slot no longer exists resolves to NOT_FOUND on its detail page, and to the title "Workout" with 0 exercises in lists. Cancel such sessions on commit (D-002 #7).

## Sprint 4

- **S4-2 (missed sweep).**
  - A `missed` session was never locked (D-002 #6 locks on start, complete or skip), so its history title follows later program commits. Lock the version when the sweep marks a session missed, or record the decision.
  - A late sync after the sweep moved a session to `missed`/`incomplete` gets `SESSION_FINISHED` (409), and the device's logs would be dropped, which conflicts with D-004 #5. Decide whether a late sync may still complete it.
- **S4-3 (review queue).** The Sprint 2 review list is read queries plus `memberships.review_seen_at`. `ReviewFlag` replaces it. Until then:
  - "This week" compares stored client-local dates with the ISO week in the **organization's** time zone (documented approximation).
  - "Mark all as seen" marks through the list's read time minus 5 seconds, so a completion still committing when the list was read stays new; one completed in the last 5 seconds before the read stays new too.
  - Lists show at most 50 items; "Mark all as seen" marks everything up to the list's read time, including completions beyond the 50 shown.
- **Coach Sessions tab.** Shows the first 25 upcoming and 25 past sessions, with no paging; the `?scope=past` the logger adds after finishing is ignored there.

## Can wait (tracked, low risk)

- **Tests.**
  - No session-list pagination test with two sessions sharing a `dueAt` (the `id` tie-break is correct by inspection).
  - No unit test for `summarize`'s "Workout" fallback.
- **Input.** A comma is only a decimal comma: "62,125" is refused along with "1,500", and the message only names the range.
- **Coaches see the whole organization.** Core never scopes a coach to their own clients (`coachUserId`). That matches R1 (one-person organizations, D-006); revisit when the `coach` role is enabled (R3).
- **Lint.** Two pre-existing `@next/next/no-location-assign-relative-destination` warnings (`invite/[token]/AcceptForm.tsx` and `select-org/OrgChoices.tsx`) remain.

## Local tooling notes (this environment, not product issues)

- `next dev` for the E2E stack can get stuck in a Fast Refresh reload loop when `apps/web/.next-e2e` is left over from an earlier, interrupted run (and after `next typegen` has written `.next`). Clear `apps/web/.next` and `apps/web/.next-e2e` before a local `pnpm test:e2e`; CI starts clean. Consider having `e2e/support/stack.ts` remove `.next-e2e` on start.
- The first spec of a cold run can time out while Turbopack compiles `/signup`; CI's `retries: 2` absorbs it. Journey specs set a 180 s timeout (240 s for the golden path).
- Client components must not value-import from the `@kinetic/core` barrel (it pulls in Prisma and `pg`); use the `@kinetic/core/units` and `@kinetic/core/exercise-options` subpaths. A dev server only fails at runtime on that page; `next build` fails outright.
- Where the embedded Postgres can't run `initdb` (for example as root in a container), point `DATABASE_URL` at any Postgres 16 with a superuser, as CI does.

## Before the first deploy

- No new items. The Sprint 0 and Sprint 1 "Before the first deploy" lists still apply.
