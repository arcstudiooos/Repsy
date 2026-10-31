# Sprint 5 — Follow-ups

Sprint 5 (Pilot-ready R1) covers Tasks 5.1–5.5 of `docs/superpowers/plans/2026-10-30-sprint-5.md` (S5-1…S5-5) on branch `claude/sprint-3-wip-9t9dd0`. Sprint 6 (S6-1, pilot operations) is process work; its material is in `docs/pilot/`. Earlier follow-up files still apply where not marked done.

## Rulings made while building (in addition to plan Rulings 1–7)

- **Analytics** live behind a new policy action `analytics:read` (owner, coach). "Time to follow-up" uses UTC day bounds for the period; adherence uses each session's stored local date.
- **Event properties.** The PRD §13 dictionary isn't in the repository, so the allowlist in `packages/core/src/ports/analytics.ts` is the minimal set the app needs (hashed ids, enum keys, counts, booleans; `org_id_hash` on all). String values with spaces are refused as possible free text. Idempotent replays don't emit twice (the handler compares the stored timestamp with the request start). `review_flag_opened` from the sweep uses a per-organization system distinct id.
- **Downloads go through the app.** Even with S3, files are streamed by `/api/v1/exports/:id/files/:name`, so "another user with the URL → 403" holds; the link token (HMAC, 15 minutes) is bound to the job, file and user, and the requester is re-checked on every download.
- **Export scope.** Organization exports: clients, sessions, set logs, check-ins (no messages or notes). Client exports: profile, sessions, set logs, check-ins and their conversation; never internal notes. Files are offered for 7 days.
- **Deletion keeps the client row** (anonymized as "Deleted client", archived) because immutable program versions point at the client copy; the user account is anonymized and signed out only when no other membership remains. A coach (non-owner) cannot request deletion; an owner can for a client.
- **Lawful erasure exemption** is a transaction-local `app.lawful_erasure` setting that only the deletion job sets; it lets `set_log_revisions` rows be deleted and nothing else. Like `app.bypass_rls`, it is an application convention: the runtime role could set it, so code review must keep it confined to `eraseClientData`.
- **The admin console** answers 404 to non-admins (proxy and core), not 403. Admin API routes need no active organization.
- **Paused clients count** toward the active-client limit (from Sprint 3) and adherence never counts paused time (sessions move out of the paused days).

## Security review notes (S5-5)

Reviewed by hand: export link tokens (HMAC with `timingSafeEqual`, bound to user/job/file, short TTL), file names from the job record only (no path from input), storage keys validated against traversal, CSV formula injection neutralized, admin routes gated in core, deletion scoped to one organization, analytics allowlist, message bodies kept out of logs/audit/email/analytics, `app_message_email_opt_in` returning one boolean for org members only. `pnpm audit --prod`: no known vulnerabilities (2026-10-30). Not done: a third-party penetration test.

## Before the pilot (not code)

- Hosted deploy, then the restore drill and the manual accessibility pass, recorded in `docs/runbook.md` and `docs/accessibility-checklist.md`.
- Counsel reviews `docs/legal/privacy-notice-draft.md` and `docs/legal/health-data-notice-draft.md`; the in-app privacy notice text and version then change accordingly.
- Bucket lifecycle rule deleting `exports/` after 8 days.
- Mint pilot codes from `/admin`; set `POSTHOG_KEY` and `ANALYTICS_HASH_SECRET` if analytics should run.

## Can wait (tracked, low risk)

- The exports list shows the last 20 exports; expired files stay in storage until the bucket lifecycle removes them.
- The admin console lists the last 200 deletion requests and 50 grants; no search.
- `deletions.run` removes export files after the database commit; a storage failure there is logged and leaves orphaned objects for the lifecycle rule.
- Screenshots include the Next.js dev-tools button (captured from the dev server).
- The perf script measures the dashboard's queries in-process, not a full page render over HTTP.
- **E2E around midnight UTC.** Specs that assign "today's" workout fail when a test starts before midnight and finishes after (seen in `workout-logging.spec.ts` at 00:00 UTC; both passed on rerun). CI's retries absorb it; a fixed clock (`page.clock`) would remove it.
- `openClientTab` now waits for the client page and retries the tab click until the URL follows (a click during hydration could be lost; seen once in `closed-loop.spec.ts`).
