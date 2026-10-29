# Kinetic — Decisions Log

Decisions that resolve ambiguities, contradictions and gaps in the Kinetic PRD (v1.0, 29 Oct 2026), as required by the PRD's "Operating rules for agents". Each entry records the decision, why, and what it supersedes in the PRD.

Status key: **Locked** = agreed with the founder. **Proposed** = recommended default awaiting confirmation.

---

## D-001 — Program versioning: copy-on-assign with immutable history

**Status:** Locked (2026-10-29)
**PRD refs:** F06, F07, Journey B, §8 (`programs`, `program_weeks`, `workouts`, `program_assignments`), §8.1 invariant 4, §9 `PATCH /programs/:id`
**Gap resolved:** Weeks/workouts FK'd straight to `program_id`, so edits rewrote history; fork semantics for a template assigned to many clients and then edited for one were undefined.

**Decision**
1. **Programs are reusable templates.** Coaches build master programs in `/app/programs`.
2. **Independent client copies.** Assigning a program creates a separate copy for each client.
3. **Isolated changes.** Editing the master does not affect existing assignments. Editing one client's program does not affect any other client.
4. **Version history.** Each committed program save creates a new version. Previous versions are preserved.
5. **Historical integrity.** Completed workouts, and workouts with any logged activity, stay linked to their original, immutable workout versions.
6. **Future updates only.** Only future sessions that have not been started can adopt a newer version.
7. **No bulk push in R1.** No "push changes to all N clients". Candidate for R2: a bulk update with a preview of exactly which clients and upcoming sessions are affected.

**Safeguards**
- When a coach saves changes to a client's assigned program, show: *"This update will apply only to upcoming workouts. Completed and already-started workouts will remain unchanged."*
- Concurrent edits use optimistic concurrency (`expectedVersion`). A mismatch returns 409 with the current version and never silently overwrites (PRD §9.1).

**Why:** Individualized coaching and preserving workout history matter more than bulk-editing convenience. Example: a coach assigns one 4-week program to 8 clients. After two weeks, one client needs lighter work and another needs more intensity. Each client's remaining workouts can change without touching anyone else's history.

**Also resolves:** The templates contradiction (P1 "reusable templates" R2 vs §2.3 "plan templates" R1 vs §18 "workout templates" R2). In R1, any master program is reusable via copy-on-assign. A dedicated template library and management UI are R2.

---

## D-002 — Workout version and session representation

**Status:** Locked (2026-10-29)
**PRD refs:** F06, F07, F08, Journey B, §8 (`workouts`, `workout_exercises`, `workout_sessions`, `set_logs`), §8.1, §10 Rule 1
**Gap resolved:** How sessions reference versioned workouts, when sessions are generated, and how edits reach upcoming sessions without duplicating records or breaking historical logs.

**Decision**
1. **Immutable `workout_versions`.** A workout's title, exercises and targets (sets, reps, load, RPE, rest, tempo) live in an immutable version row with its child exercise rows. Changing a workout creates a new workout version.
2. **Program version = slot map.** A program version maps slots `(week_index, day_index)` to `workout_version_id`. A new program version creates new workout versions only for the workouts that changed. Unchanged workouts are shared between program versions.
3. **Draft autosave, explicit commit.** Builder edits autosave to a draft (F06 saved/saving/offline/error feedback). Only an explicit "Save changes" commits a new program version. That is when the D-001 confirmation appears.
4. **Sessions generated at assign time.** Assigning creates one `workout_sessions` row per scheduled slot for the whole assignment, with `slot_key`, `scheduled_for` and `due_at` (computed in the client's timezone, stored in UTC).
5. **Unstarted sessions resolve late.** An unstarted session has `workout_version_id = NULL` and displays the workout in its slot from the client's current program version. Committed edits reach upcoming sessions with no session rewrites.
6. **Lock on Start.** `workout_version_id` is written permanently when the client taps **Start Workout**. Workouts therefore never change under a client mid-session. It is also written when a session is completed or skipped without being started. After locking, the version never changes and set logs are recorded against it.
7. **Structural edits.** If a committed version removes a slot, that slot's unstarted sessions become `cancelled` (never deleted). Added slots get new sessions.

**Why:** Delivers D-001's guarantees with structural sharing instead of full-program copies per save. Pre-generated sessions keep Rule 1 (missed workouts) and adherence as simple indexed queries. Trade-off: rendering an upcoming session needs a lookup through the assignment's current program version.

---

## D-003 — Client pause and session rescheduling

**Status:** Locked (2026-10-29)
**PRD refs:** F03 (paused status), F07, §10 Rule 1 and adherence calculation, QA matrix "paused assignment"
**Gap resolved:** Behavior of sessions when a client is paused was undefined.

**Decision.** Pausing preserves the training sequence, shifts upcoming unstarted sessions forward, and excludes paused time from adherence.

| Scenario | Behavior |
|---|---|
| Coach pauses client (e.g. 7 days) | Unstarted sessions dated on or after the pause start shift forward by the pause duration |
| Completed sessions | Unchanged |
| Started / partially logged sessions | Unchanged; keep their locked workout version |
| Missed sessions before the pause | Remain missed |
| Sessions scheduled during the pause | Shift forward with the remaining schedule |
| Adherence | Paused period excluded from eligible training days |
| Client portal | Shows "Program paused" and the expected resume date |
| Coach dashboard / review queue | Shows paused status; no missed-workout flags generated for paused time |

**Rules**
1. **Preserve sequence.** A client due to start Week 3 on Monday resumes with Week 3 after the pause and does not skip to Week 4.
2. **Configurable duration.** R1 pause = start date + expected resume date. Seven days is an example, not a fixed length. No multiple pause modes or advanced scheduling in R1.
3. **Timezone-correct.** Shifts are calculated as calendar-date offsets in the client's timezone, then stored as UTC. This is correct across daylight-saving transitions.
4. **Idempotent.** Rescheduling is transactional and idempotent. Resuming or editing a pause never shifts sessions twice. *(Builder call: store each pause as a `client_pauses` row and the applied offset per session. Editing the resume date applies only the delta, and resuming early pulls unstarted sessions back by the unused days.)*
5. **History untouched.** Completed session dates, locked workout versions and set logs are never changed.

**Coach confirmation copy**
> **Pause client's program?**
> Upcoming workouts will move forward by the pause duration. Completed workouts and existing progress will remain unchanged. The paused period won't affect adherence calculations.

---

## D-004 — Offline continuity for workout logging (not offline-first)

**Status:** Locked (2026-10-29)
**PRD refs:** F08, Journey C, §4 workout screen, §12 durability, §2.3 ("Offline editing / native app" = R2), §8.1 invariant 3, QA matrix "duplicate log"
**Gap resolved:** Journey C requires no data loss on intermittent connections, but offline support was deferred to R2.

**Decision.** R1 supports offline *continuity* once a workout has been opened, not full offline-first.

**R1 requirements**
1. **Online opening.** A client needs connectivity to open a workout the first time.
2. **Local caching.** On **Start Workout** (online), the session's workout version is locked (D-002) and the full workout is cached locally: exercises, sets, reps, targets, instructions.
3. **Offline logging.** The client can log sets, change reps and weights, and complete or skip the workout without connectivity, always against that exact cached immutable version.
4. **Automatic sync.** Unsynced changes are stored on the device (IndexedDB outbox) and sync automatically when connectivity returns.
5. **No data loss.** Refreshing, closing and reopening the app, or losing connectivity never erases logged progress.
6. **Clear sync status.** Show **Saved on device**, **Syncing**, **Synced**. The UI never claims cloud sync until the server has acknowledged the write. This supersedes the PRD §6.3 sample microcopy for the logging screen.
7. **No duplicates.** Stable client-generated IDs and idempotency keys. Set logs upsert on a unique `(session_id, workout_exercise_id, set_index)` key, so replays never double-enter.

**Out of scope for R1:** opening previously uncached workouts with no connection; downloading whole programs for offline use; offline program editing by coaches; complex multi-device offline conflict resolution.

**Acceptance test (Playwright, offline emulation):** Start a workout online → go offline → log every set → complete → close and reopen the app → reconnect → everything syncs once, with no loss and no duplicates.

**Builder notes**
- *Reopening while offline* needs the app shell and the in-progress workout route to load with no connection. R1 therefore ships a **minimal service worker** that caches only the portal shell, static assets and the active session route. This is not a general offline cache.
- *Simple multi-device rule (builder call):* the server keeps the most recent write per set by client-recorded `updated_at`. No merge UI in R1.
- Check-in drafts use the same local-draft mechanism, but submission requires connectivity.

---

## D-005 — Hosting and background jobs: Render, web + worker, Postgres-backed queue

**Status:** Locked (2026-10-29). Queue choice is a builder call within the founder's stated preference.
**PRD refs:** §7 (hosting, background jobs), §7.1 job worker, F10 ("queue reflects state immediately"), F11 email notifications, §7.2 idempotency
**Gap resolved:** BullMQ needs a persistent worker that Vercel can't host. The review queue was described as both "immediate" and "weekly refresh".

**Decision**

| Component | Choice |
|---|---|
| Web app + API | Next.js as a **Render Web Service** `web` (paid Starter or higher; the free tier sleeps) |
| Background worker | **Render Background Worker** `worker` (always-on Node.js; same repo and shared domain code) |
| Database | **Render Postgres** (paid; free instances expire after ~30 days), shared by both services |
| Job queue | **pg-boss (Postgres-backed)**. No Redis in R1. |
| File storage | S3-compatible private bucket (exports) |
| Monitoring | Sentry (web + worker) |
| Product analytics | PostHog (privacy settings per §13) |

**Hosting change (2026-10-29):** originally Railway; switched to Render because Railway is not accepting new sign-ups (founder: "Lets work with render then"). Application code is unchanged; only deployment config differs.

**Render specifics**
- All three resources are defined in a `render.yaml` Blueprint at the repo root, auto-deploying from GitHub.
- A single `web` instance in the pilot, so the in-memory rate limiter (Task 0.4) remains acceptable.
- **Data isolation on Render:** the default database user owns the tables, and owners/superusers bypass Row-Level Security. Deployment therefore creates a separate **non-owner app role** (`NOSUPERUSER NOBYPASSRLS`) via SQL, grants it table privileges, keeps `FORCE ROW LEVEL SECURITY`, and both services connect with that role at runtime. Migrations (and pg-boss schema creation) use the owner connection. The app refuses to start if its runtime connection is the table owner, a superuser, or has `BYPASSRLS`. Role creation must be verified on Render during setup; if Render's managed Postgres does not allow it, stop and escalate to the founder.
- **Client IP:** rate limiting reads the client address as set by Render's proxy in `X-Forwarded-For`, trusting only the proxy hop, never a client-supplied leftmost value.

**Rules**
1. Web and worker deploy as separate services against one Postgres database.
2. Email notifications and scheduled jobs run in the worker.
3. Every job is retryable (exponential backoff) and idempotent (stable job keys / unique constraints).
4. **Workout logging and sync never depend on the worker.** Client sync writes go straight to the web API and Postgres.
5. Critical data (logs, check-ins, flags, messages) is persisted in Postgres before any job is enqueued.

**Review queue timing**
- *Event-driven flags* ("new check-in", "coach follow-up", auto-resolve of overdue check-in on submit) are written in the same DB transaction as the triggering event, so the queue is immediate.
- *Time-based flags* (missed two workouts, overdue check-in, unread message >24h) come from a worker sweep scheduled every 10 minutes (pg-boss cron). The sweep is idempotent. There is no "weekly refresh" job; the PRD's weekly refresh is superseded.
- Email sends go through an outbox table. The worker delivers and retries.

**Why pg-boss over Redis + BullMQ:** The founder asked to avoid unnecessary infrastructure if a database-backed system is reliable enough. At pilot scale (≤20 coaches, ≤50 clients each), Postgres handles this easily, needs one fewer service, and enqueues jobs transactionally with the data that triggers them. Revisit BullMQ only if measured load requires it. Jobs sit behind an adapter (§7.1), so swapping is contained.

---

## D-006 — Authentication: Better Auth in our own app and Postgres

**Status:** Locked (2026-10-29). Role mapping pending (see open item).
**PRD refs:** F01, F04, §2.3 Account row, §7 Authentication, §8 (`users`, `memberships`, `client_invites`), §11 security, QA "Auth / tenant"
**Gap resolved:** The Auth.js credentials provider lacks built-in verification and reset, and JWT sessions can't be revoked (F01 requires revocation).

**Decision**

| Component | Decision |
|---|---|
| Authentication | Better Auth (current recommended Prisma adapter and session config) |
| Storage | PostgreSQL via Prisma; users, accounts and sessions in our DB |
| Login methods | Email/password **and Google OAuth** |
| Sessions | Database-backed, secure httpOnly cookie sessions; revocable server-side |
| Password recovery | Email-based reset |
| Email verification | Required (email/password sign-ups) |
| MFA | R2 |
| Clerk | Not used in R1 |

**Supersedes:** PRD §2.3 lists social sign-in as R2. Google OAuth moves into R1.

**Rules**
1. **Authentication ≠ authorization.** Better Auth verifies identity only. Kinetic's service layer enforces roles, coach–client permissions and tenant scope on every read and write (PRD §7.2).
2. **Invitation-based client onboarding.** Coaches invite clients via secure, expiring, single-use links (hashed tokens, F04).
3. **Tenant isolation.** A coach never accesses another coach's clients. `organization_id` is always derived server-side, never trusted from the UI.
4. **Dual roles.** One account can be both a coach and a client (e.g. a coach who is also coached), via separate memberships and no duplicate accounts.
5. **No sensitive leakage.** Password hashes, session tokens and private client data never leave the server or appear in logs or analytics.

**Roles (locked 2026-10-29)**
- **Platform `admin` = Kinetic staff.** A platform-level flag on the user, not an organization membership. Used for pilot access, account support lookups and processing export/deletion requests.
- **Organization memberships:** `owner` and `client` (PRD F01). In R1 each signing-up coach becomes `owner` of their own one-person organization. The `coach` (assistant) membership role exists in the schema but is disabled until team rollout (R3), as F01 states.
- **Admin support access** to a client record is explicit, time-boxed and audited. Admins do not browse client training data or messages by default. *(Locked via D-008 #19.)*
- **Coach registration requires a pilot code** issued by an admin, consistent with the §14 invite-only pilot. *(Locked via D-008 #19.)*

**R1 acceptance criteria**
- Coaches and clients can register, log in, log out and reset passwords.
- Invitations link clients to the correct coach and organization.
- Users cannot access another coach's private client data (adversarial cross-tenant tests).
- One user can hold multiple coaching relationships without duplicate accounts.
- Expired or revoked invitations and revoked sessions are rejected.
- Auth works consistently across Render deployments (stable secret and base URL per environment; preview, staging and production configs).

---

## D-007 — No injury or medical intake in R1; minimal onboarding

**Status:** Locked (2026-10-29)
**PRD refs:** F03 ("known constraints"), F04 ("optional limitations"), F09 (wellbeing), F11, §11 data minimization and safety, §13 analytics exclusions
**Gap resolved:** F03/F04 collect constraints and limitations while §11 excludes medical data from the MVP. Fitness and wellbeing data may be "consumer health data" under Washington's My Health My Data Act (MHMDA).

**Decision**
1. **Client onboarding collects:** name, email, timezone, preferred units, and basic fitness goals. Nothing else is required.
2. **No injury or medical-history fields in R1.** F03's "known constraints" and F04's "optional limitations" are removed from R1.
3. **Coach-led conversation.** Clients can voluntarily raise concerns with their coach through private messaging.
4. **Messages are protected as potentially sensitive.** Removing the field doesn't stop sensitive information appearing in messages. Message bodies are access-controlled to the coaching relationship, never sent to analytics, never written to logs or audit payloads (PRD §11, §13), and admins cannot read them by default.
5. **Safety reminder.** Before a client's first program starts, the portal shows a short reminder to tell their coach about any limitations relevant to safe training.
6. **No medical clearance claims.** Kinetic never presents itself as providing medical clearance. Coaches confirm that a client is ready for assigned exercises before training begins.

**Further rules**
- **Coach readiness confirmation** *(locked via D-008 #19)*: on a client's first assignment, the assign dialog includes a required checkbox, "I've confirmed this client is ready to start this program." It is stored on the assignment with an audit event.
- *Builder call:* wellbeing check-in questions (energy, sleep, stress, satisfaction on 1–5 scales) are **optional**, never drive review flags, and are never sent to analytics.
- *Builder call (consistent with D-008 #16–17):* client training and check-in data are treated as potentially consumer health data. Explicit consent at onboarding (F04 privacy step), a health-data privacy notice, honored export and deletion. **Counsel review before the paid pilot** (PRD §11 Legal).

---

## D-008 — R1 scope, rules and numbers

**Status:** Locked (2026-10-29). #16 is subject to legal exceptions; #17 is provisional pending legal review.
**Principle:** Deliver a polished, reliable pilot, not a feature-heavy competitor. R1 priority loop: **invite client → assign program → log workout → identify attention needed → complete check-in → take the next action.** Dropped features return only on validated pilot-coach demand, not speculation.

| # | Decision | PRD refs / supersedes |
|---|---|---|
| 1 | **Messaging:** text-only 1:1 threads, unread counts, pagination, sent/read state, opt-in email notification. No attachments, no edit/delete (messages are immutable). **Analytics:** §2.1 coach-level counts (assigned vs finished workouts, response rate, due check-ins, time-to-follow-up), each with numerator, denominator and period, plus CSV export. No charts or cohorts on `/app/analytics`; the client portal keeps one simple progress view. | F11, F13, §6 `/app/analytics`. Supersedes F11 attachments, edit/delete and "delivery states" beyond sent/read; cohorts → R2 |
| 2 | **Delivery:** AI coding agents implement; the founder directs and reviews. Target first pilot **10–12 weeks after Sprint 0**. | §15 |
| 3 | **Individual assignments only.** No group assignment. | §19 Q2 |
| 4 | **Session states:** `scheduled` → `in_progress` (started) → `completed` / `skipped` (explicit client action). Derived after due + grace: unstarted → **`missed`**, started-not-completed → **`incomplete`**. Also `cancelled` (D-002) and `paused-shifted` handling (D-003). **Only `missed` sessions trigger Rule 1** (2 missed in rolling 7 days). | F07, F08, §10 Rule 1. Resolves F07 vs Rule 1 vs adherence |
| 5 | **Grace period:** one coach-configurable setting, default **24h**, range **0–72h**, applied to workouts and check-ins. | F07, §10 Rule 2. Supersedes Rule 2's fixed 24h |
| 6 | **Log edits:** client may edit a submitted log for a fixed **24h** after submission. Coach corrections allowed at any time with a required reason, creating an audited log revision. | F08. Supersedes "configurable 24-hour period" |
| 7 | **Coach-logged sessions:** coaches can log a workout on a client's behalf; shown as **"Logged by coach"** (`logged_by_user_id`). | Gap: hybrid coaches |
| 8 | **Tracking types:** each exercise is reps+load, duration or distance. Set logs carry optional `reps`, `weight_kg`, `rpe`, `duration_seconds`, `distance_m`. Weight stored in kg, displayed in the user's preferred units. | F05, F08, §8 `set_logs` |
| 9 | **Check-ins:** one seeded, editable check-in template per coach (question types: 1–5 scale, short text, yes/no). One weekly check-in per client on a coach-selected weekday. | F09, §8 `checkin_templates` |
| 10 | **Notifications:** no scheduled reminders in R1. Essential transactional emails (verification, password reset, invitations, "check-in ready") plus opted-in new-message notifications. | §2.3 vs §18. Reminders → R2 |
| 11 | **Review actions:** snooze for 1 day, 3 days, 1 week or a custom date. Dismiss and resolve require a reason. | F10 |
| 12 | **Billing:** paid pilots are invoiced outside the app. No in-app checkout or subscription management. The app shows "Pilot access" and its limits. | F14, §14 |
| 13 | **Pilot limits:** max **30 active clients per coach**. Unlimited programs, exports and messages. | F14, §2.3 "basic tier limits" |
| 14 | **Invitations:** expire after **7 days**, single-use, previous link revoked on resend. | F04, §8 `client_invites` |
| 15 | **Passwords:** minimum **12 characters**, breached-password check, login rate limiting, no arbitrary complexity rules. | F01, §11 |
| 16 | **Deletion:** lawful deletion is permitted (immutability forbids *silent edits*, not lawful erasure). Target processing within **30 days**; audit retention is content-free (IDs and actions only); backups expire within **35 days**. Subject to legal exceptions. | §8.1, §11 Retention, Journey E |
| 17 | **Data roles:** coach's business = controller, Kinetic = processor. **Provisional pending legal review.** | §11 Legal |
| 18 | **Design tokens:** Warning `#8F5A26` (5.74:1 on white, 5.39:1 on canvas); new **Input border** `#7D8C87` (3.52:1 on white, 3.30:1 on canvas); `#E1E8E4` kept for **decorative dividers only**. | §6.2. Fixes AA failures |
| 19 | Explicit, audited platform-admin support access; pilot-code coach registration; readiness confirmation on first assignment. | D-006, D-007 |

**Implementation clarifications**
1. **Missed vs skipped vs incomplete.** A started but never completed workout becomes **`incomplete`**, not `missed`, and raises no missed-workout flag.
   **Adherence (R1)** = completed eligible sessions ÷ all eligible sessions whose due window (due + grace) has ended. Skipped and incomplete sessions stay in the denominator and are **reported separately**. Paused and cancelled sessions are excluded. Always show numerator, denominator and period. A zero denominator shows "No sessions due yet", not 0%.
2. **Historical versions.** Log corrections never touch the locked workout version (D-002). Editing logged sets creates audited **log revisions**, not a new workout definition.
3. **Notification preferences.** Essential transactional emails (verification, password reset, invitations) are always sent. Opt-in new-message notifications are a separate preference. **Marketing preferences are separate again** (R1 sends no marketing email).
4. **Privacy and deletion.** The 30-day and 35-day figures are internal operational commitments, not substitutes for jurisdiction-specific law. Deletion workflows are built to accommodate retention obligations (e.g. legal holds) and individual rights.

**Schema fixes adopted (builder, no product impact)**
- `organization_id` on every tenant-owned table, including `workout_sessions`, `set_logs`, `checkins`, `review_flags`, `internal_notes`, `messages`, with composite FKs or checks so parent and child tenants match (§8.1).
- `review_flags`: `state` (open/snoozed/resolved/dismissed), `snoozed_until`, `resolved_by`, `resolved_at`, `resolution_reason`, `evidence_json`, plus a dedupe key per rule and source.
- `clients`: `timezone`, `preferred_units`, `consent_version`, `consent_at`, `ready_confirmed_at/by` (via assignment).
- `workout_sessions`: `comment`, `logged_by_user_id`, `started_at`, `completed_at`, `state`, `workout_version_id` (nullable until start).
- `set_logs` revisions table for audited corrections. Messages have no `edited_at`/`deleted_at`, since they're immutable in R1.

---

## D-009 — Build strategy: thin loop first, then deepen; pnpm monorepo

**Status:** Locked (2026-10-29)
**PRD refs:** §15 sprint plan, §15.2 agent rules, §7 stack, §7.1 architecture

**Approaches considered**
- **A. PRD layer order.** Each sprint completes one area (clients → programming → client logging → review/messaging). Simple to reason about, but the full loop first runs end to end in Sprint 4 (~week 8). Integration problems surface late, and nothing can be shown to a coach before then.
- **B. Thin loop first, then deepen (chosen).** Sprints keep PRD numbering and definitions of done, but each delivers a working slice of the loop. The first end-to-end workflow exists by the end of Sprint 2. Costs some rework of early UI, but the founder can review real end-to-end behavior every week. That suits agent-driven implementation directed by the founder.

**Sequence**

| Sprint | Priority | Expected outcome |
|---|---|---|
| 0 | Monorepo, database, authentication, CI/CD, Render deployment | Working technical foundation |
| 1 | Coach onboarding, client invitations, basic program creation and assignment | Coach can onboard and assign |
| 2 | Mobile workout logging, basic coach review list (statuses and counts) | First complete end-to-end workflow |
| 3 | Immutable versions, edit conflicts, offline continuity | Reliable workout experience |
| 4 | Check-ins, full review rules (missed, adherence, snooze, resolution), text messaging | Complete coaching workflow |
| 5 | Analytics counts, CSV exports, QA, performance, security, accessibility | Pilot-ready R1 |
| 6 | Pilot iteration (PRD §15): time-on-task tests, retention events, bugs, pricing probe | Go/no-go decision with evidence |

**Non-negotiable rules**
1. **Thin, not disposable.** Early sprints use the agreed data architecture (D-001, D-002), tenant isolation (D-006) and immutable workout-version principles from the first migration. UI may be simplified; temporary data models that later need major migrations are not allowed.
2. **Golden-path E2E from Sprint 2.** A Playwright test covers: coach signs up → invites client → creates program → assigns program → client starts workout → logs sets → completes workout → coach sees updated review information. Every later sprint keeps it passing in CI.
3. **Finish each vertical slice.** A slice is complete only with functionality, loading/error/empty states, responsive UX (375/768/1440), permission checks, and relevant tests (PRD Operating rules, §15.2).

**Sprint 2 review scope:** the review list shows straightforward statuses and counts (e.g. new completed sessions, sessions due). The full missed-workout rule, adherence, snooze and resolution rules arrive in Sprint 4.

**Repository layout**
```
kinetic/            (repo root = D:\Gym)
├── apps/
│   ├── web/        # Next.js App Router + Better Auth (Render Web Service "web")
│   └── worker/     # pg-boss background jobs (Render Background Worker "worker")
├── packages/
│   ├── core/       # Domain logic and business rules; no provider SDKs (adapters only)
│   └── db/         # Prisma schema, migrations, seed; PostgreSQL
└── docs/
    ├── decisions.md
    ├── architecture/
    └── implementation-plan.md
```
Render hosts `web` and `worker` with one Render Postgres database (D-005).

---

## D-010 — Scheduling, assignments, check-ins, privacy workflows, environments

**Status:** Locked (2026-10-29)
**PRD refs:** F07, F09, F14, Journey E, §8 (`program_assignments`, `workout_sessions`, `checkins`), §10 Rules 1–2, §11, Appendix B
**Gap resolved:** Builder-check questions: slot-to-date mapping, concurrent assignments, check-in lifecycle, export/deletion ownership, domain and provider accounts.

### 1. Program scheduling (refines D-002)
- Each program week holds an **ordered list of training days** (Day 1, Day 2, Day 3…). `slot_key = (week_index, day_index)`, where `day_index` is the ordinal training day, not a weekday.
- On assignment the coach picks a **start date** and the client's **training weekdays**. The coach must select **exactly as many distinct weekdays as the program has training days per week**.
- Sessions fill the ordered slots onto the selected weekdays, starting on the first selected weekday on or after the start date, and continue across program weeks. *Example:* Day 1–3, Mon/Wed/Fri, start Wednesday → W1D1 Wed, W1D2 Fri, W1D3 Mon, W2D1 Wed…
- Weekdays not selected are planned rest days (Rule 1 skips them).
- **Due** = 23:59 local on the scheduled day; then the grace period (D-008 #5) applies.
- Dates are calculated in the client's timezone (DST-correct). Timestamps are stored in UTC, **and the intended local calendar date is stored too** (`scheduled_local_date`).
- *Builder call:* programs where weeks have different numbers of training days are rejected at assignment in R1 (every week must match the selected weekday count).

### 2. Assignments
- **One active assignment per client** (partial unique index on active status).
- Assigning a new program requires explicit confirmation. It ends the current assignment and cancels that assignment's unstarted sessions dated on or after the new start date.
- **Replacement never modifies completed or started sessions.**
- When the last slot passes, the assignment becomes `completed`. Nothing repeats automatically.

### 3. Weekly check-ins
- The worker issues each check-in at **06:00 client-local** on the coach-selected weekday and sends the "check-in ready" email then.
- **Due 23:59 local** the same day, then the grace period. Rule 2 (overdue) fires after due + grace.
- **No check-ins are issued during a pause**, so no overdue flags arise for paused time.
- Changing the weekday applies from the next issue. An already-issued check-in is unchanged.
- **Generation is idempotent:** unique `(client_id, period_local_date)`. Sweep reruns never duplicate.

### 4. Export, deletion, archiving
- **Export is self-serve and automated.** A client exports their own data; a coach (owner) exports organization CSVs. It runs as a worker job; the file goes to a private bucket and is served via a **short-lived, access-controlled link scoped to the requesting user or organization**.
- **Deletion:** the request is logged (audit) and the coach is notified. A Kinetic admin verifies it and triggers a tested, idempotent deletion job. The job is **audited** and **never removes data belonging to unrelated coaching relationships** (e.g. a dual-role user's other memberships). Retention obligations follow D-008 clarification 4.
- **Archiving** a client removes their access to that coach's organization. The user account and any other relationships are unaffected.

### 5. Environments, domain and credentials
- **Placeholder domain in Sprint 0.** No domain purchase or brand finalization until trademark and domain availability checks are done.
- Use Render-generated `onrender.com` URLs initially. The app base URL, Better Auth URL, OAuth callback URLs and email link base all come from **environment variables**. **Never hardcode `kinetic.com` or any unverified domain.**
- Add `staging.<final-domain>` after purchase. The final name and domain can change without architectural changes.
- **The founder creates and owns all provider accounts** (Render, Google Cloud OAuth, Resend, Sentry, PostHog, Cloudflare R2 / S3-compatible) and sets keys as Render environment variables (or an environment group). Agents never hold production credentials.
- **Credentials are never committed to Git or written in documentation.** Only `.env.example` with placeholders (PRD §15.2).
- Separate `staging` and `production` environments. Previews use synthetic seed data only.
- *Builder call:* email transport is Resend behind an email adapter. In local development and CI, a console/file adapter is used, so no provider account is needed to run tests.
