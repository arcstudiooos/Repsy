# Sprint 4 — Follow-ups

Sprint 4 (Complete coaching workflow) covers Tasks 4.1–4.7 of `docs/superpowers/plans/2026-10-30-sprint-4.md` (S4-1…S4-5), on branch `claude/sprint-3-wip-9t9dd0` after Sprint 3. This file records rulings made while building, deviations and what was knowingly deferred. Earlier follow-up files still apply where their items are not marked done below.

## Rulings made while building (in addition to plan Rulings 1–7)

- **A check-in keeps its questions** (`checkins.questions_json`), an addition to the target model, so later template edits never change what was asked.
- **Check-ins can be sent after their due time**; they are then shown as "Past due" and raise the overdue flag until sent.
- **Missed-workout episodes.** At most one open or snoozed `missed_workouts` flag per client. It cites every missed session in the window and is resolved automatically only when a cited session stops being `missed` (a late start or finish); the rolling window passing never closes it.
- **Unread-message flags** cite the oldest unread client message per thread; reading the thread resolves it on the next sweep.
- **Snoozes to a date** end at 00:00 that day in the organization's time zone.
- **Follow-ups** carry a coach-written title (≤ 200 characters) in their evidence; it is the coach's own text, never client content.
- **Message email opt-in lookup.** Preference rows stay self-only under RLS; `app_message_email_opt_in(uuid)` (migration 000025) returns only that boolean, only for a member of the current organization, with the bypass scoped to the function call (`@repsy/db` `wantsMessageEmail`).
- **Idempotent message sends** use an optional `clientMessageId` (unique per thread), an addition to the target model.
- **Late sync after the sweep** (Sprint 2 and 3 follow-up): set logs are accepted on `incomplete` sessions, and `missed` / `incomplete` sessions can still be started or finished. A late finish re-evaluates Rule 1.
- **Missed sessions are locked** to their slot's version when the sweep marks them (Sprint 2 follow-up).
- **Test databases set `search_path`** to their schema (`createPrismaClient`), so raw SQL that names app functions resolves the same way as Prisma's qualified names.

## Plan deviations (recorded, no action needed)

- The review queue lives at the top of `/app/review`; the Sprint 2 activity lists (new completed, due, skipped this week) stay below it, so their anchors and specs keep working.
- History is its own client tab (`/app/clients/[id]/history`).
- The dashboard "missed workouts" card counts missed sessions due in the last 7 days (all clients), not open flags.

## Sprint 5

- **S5-1 analytics:** adherence excludes paused and cancelled sessions (D-003, D-008 clar. 1); `client_pauses` holds the dates, and missed/incomplete states now exist.
- **S5-2 exports:** include check-ins (questions snapshot + answers) and the client's own messages; never internal notes in a client export.
- **S5-3 deletion:** messages are immutable except `read_at`, but the trigger allows DELETE so lawful erasure works; the deletion job must remove a subject's messages, check-ins, flags and notes within the relationship scope.
- **S5-4 events:** `checkin_submitted`, `review_flag_opened`, `review_flag_resolved`, `coach_message_sent` are emitted nowhere yet.

## Can wait (tracked, low risk)

- No nav badge for unread messages (the inbox shows counts).
- The inbox and threads refresh by polling (15 s), not push.
- The timeline shows up to 200 events (100 per source); no paging.
- A second coach in an organization can read, not edit, another coach's notes (R1 organizations have one coach).
