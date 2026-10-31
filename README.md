# Kinetic

Coaching web app. pnpm monorepo.

- `apps/web` - Next.js (App Router) web app
- `apps/worker` - background worker
- `packages/core` - domain logic (no provider SDKs)
- `packages/db` - database schema and access

## Local development

Prerequisites: Node 24 (`nvm use`), pnpm (`corepack enable`), Docker Desktop.

```sh
pnpm install
pnpm db:up                 # Postgres 16 on localhost:54320 (waits until healthy)
cp .env.example .env       # repo root; works as-is with no provider keys
# edit .env: set SEED_PASSWORD to any local value of 12+ characters
pnpm db:migrate            # prisma migrate deploy against DATABASE_URL
pnpm db:seed               # demo users + prints a pilot code once
pnpm dev                   # web (http://localhost:3000) + worker together
```

Open http://localhost:3000 and sign in as `coach@example.test` (or `admin@example.test`) with your `SEED_PASSWORD`, or sign up with the printed pilot code.

- With provider keys blank: emails go to the dev sink, Google sign-in is hidden, Sentry and PostHog are off.
- Verification and reset emails land as JSON files in `DEV_EMAIL_DIR` (blank = `.dev-emails/` at the repo root), also listed at http://localhost:3000/api/dev/emails. Open the link in the `text` field.
- `pnpm dev`, `pnpm db:migrate`, `pnpm db:seed`, `pilot-code:create` and `pgboss:migrate` read the root `.env` (Node's built-in env-file loader; variables already set in the shell win). `pnpm test` does not.
- `pnpm db:down` stops the container (data persists in a named volume).

## What works locally (R2, in progress)

R2 builds the web-platform features in `docs/competitive/complete-platform-prd.md`, one per PR.

- **I5 per-client adherence:** the client list shows each client's adherence over the last 7, 30 and 90 days (completed of due workouts, ending today in the client's time zone), and the client Overview has an Adherence card with skipped, not finished and missed counts. Same rules as `/app/analytics`: paused and cancelled workouts are left out, and nothing due reads "No sessions due yet".

- **E6, E7 personal records and exercise history:** a Progress tab on each client (coach) and `/portal/progress` (client, linked from Home) show per-exercise records from completed workouts: estimated 1RM (Epley, labelled estimated), heaviest set, rep maxes for 1-10 reps, best session volume, most reps in a set, longest duration and distance. Each exercise opens every workout it was done in. Coach corrections update the records; skipped and unfinished workouts never count.

- **E1 body metrics:** clients (portal Progress) and coaches (client Progress tab) record body weight, body fat, waist, hips, chest, arm, thigh, resting heart rate and steps, one value per metric and day, in the client's units (pounds and inches for lb users). Each metric shows its latest value, change and history. A coach changing a value gives a reason (coaches only); every change keeps an append-only revision. Included in exports and erased by deletion.

- **C13 template library:** `/app/programs` has a title search and Active/Archived views; each template can be duplicated ("Copy of …", from its current version) or archived and restored. An archived template can't be assigned; clients already on it keep their own copy.

- **C10 longer programs:** programs can run up to 104 weeks (was 16), and drafts up to 1 MiB still autosave. Programs with more than 8 weeks get a "Go to week" picker beside the week tabs.

- **C11 builder fast edits:** "Replace exercise" swaps one exercise for another in every week and day (sets kept when the tracking type matches); "Adjust loads" on a week changes every set load by -50..50%, rounded to 0.5 kg or 1 lb.

- **H17 message search:** the coach inbox searches message text across conversations (newest first, never marks anything read).
- **F13/F14 check-ins reviewed and streak:** coaches mark a sent check-in reviewed (it also resolves its "New check-in" review item); clients see "Your coach reviewed this" and their on-time streak.
- **I8 dashboard:** "Check-ins waiting for your review" lists sent, unreviewed check-ins, oldest first.
- **G1-G3 habits:** coaches set daily or weekly habits per client; clients tick them off on the portal home; the coach sees a 4-week heat map and completion rates.
- **B4 tags:** coloured client tags, edited on the client page, with a tag filter on the client list.
- **B7 context card:** motivation, schedule, equipment and preferences plus pinned notes, shown on every client page.
- **G6/G7 nutrition:** daily calorie and macro targets set by the coach, a daily log for the client, and on-target days (within 10%) for both (also in exports).
- **H4/H16 messaging tools:** saved replies to insert into a message, and reply expectations (usual reply time, office hours) shown to clients.
- **D11/D12 personal records while logging:** a "New personal record" badge on a set as it is saved, and a workout summary on finished workouts.
- **C15 print:** a printable program view (save as PDF from the browser).
- **D6/D21 logger:** a rest timer (+30 s, skip, vibrate) after each saved set, and "Same as set N" to copy the last set.
- **B17 client import:** `/app/clients/import` reads a CSV (Name or First/Last name, Email, optional Goals, Time zone, Units), previews every row with its problems, and imports the valid rows without inviting anyone.
- **A5 setup checklist:** the dashboard lists seven first-week steps that tick themselves from what exists; a coach can hide it and show it again.
- **C16 calendar:** a Calendar tab per client (and `/portal/calendar`) shows a month of workouts and check-ins; coaches drag an unstarted workout to another day or use Move, optionally shifting every later workout too (never into the past or during a pause).
- **E2 trends:** body metrics and exercises get trend charts with 4/12/26/52-week ranges, a crosshair tooltip (pointer or arrow keys) and a table view; body weight shows a 7-day average.
- **I3 review rules:** owners can turn on extra review rules in Settings: habit slipping, program ending within 7 days, reply time missed and weight change beyond a set band.
- **C14 program import:** `/app/programs/import` reads a pasted plan or spreadsheet rows, matches exercises to the library for the coach to check, and saves a new template.
- **C4/D8 alternatives and swaps:** coaches list up to 5 alternatives per exercise in the library; in a started workout a client (or coach) swaps a planned exercise for one before logging it, with a reason. The coach sees the swap on the session and in the review list, and records, "last time" and PR badges credit the exercise actually done (also in exports).
- **B18/E9 goals:** coaches set goals on a body measurement, a lift (estimated 1RM or heaviest) or a habit's completion, with a target date; progress comes from recorded data with an achieved, on track or behind label, shown on the client Overview and the portal Progress page (also in exports).
- **F8 week summary:** every check-in shows the week before as facts already logged (workouts done of planned, personal records, measurement changes, habit days, nutrition on-target days), to the coach beside the answers and to the client above the form.

## What works locally (Sprint 5)

- `/app/analytics`: adherence (completed of eligible workouts, with skipped, not finished and missed shown separately; paused and cancelled excluded), assigned vs finished, check-in response rate, due check-ins and median time to follow-up, each with its numerator, denominator and period.
- Exports: an owner exports the organization (Settings) and a client their own data (portal Profile) as CSV files. The worker (`exports.build`) prepares them in private storage (`.dev-exports/` locally, S3 in production); each download link works for 15 minutes and only for the person who asked.
- Deletion: a client (Profile) or an owner (client Overview) requests deletion; a platform admin verifies it on `/admin`, and the worker (`deletions.run`) erases the client's data in that workspace. `/admin` also has pilot codes, account lookup and audited, time-limited support access. Non-admins get a 404.
- Product events (§13) go to PostHog when `POSTHOG_KEY` is set, with hashed ids and allowlisted properties only.
- Pilot readiness: `pnpm perf:dashboard`, `docs/api/openapi.yaml`, `docs/qa-matrix.md`, `docs/accessibility-checklist.md`, `docs/runbook.md` (jobs, exports, deletion, support access, restore drill), `docs/legal/` drafts for counsel, `docs/screenshots/`, and the pilot operations kit in `docs/pilot/` (Sprint 6).

## What works locally (Sprint 4)

- Weekly check-ins: the coach edits one set of questions (1-5 scale, short text, yes/no; all optional) at `/app/check-ins` and picks each client's check-in day on their Check-ins tab. The worker (`checkins.issue`, every 10 minutes) sends it at 06:00 in the client's time zone with a "check-in ready" email; it is due 23:59 that day and never sent while the program is paused. The client fills it in from the portal (the draft autosaves and survives a reload); the coach reads the answers beside the week before.
- Messages: one conversation per client, text only, with unread counts and sent/read state, at `/app/messages` (two panes on desktop), on the client's Messages tab and at `/portal/messages`. Email notifications only for users who opted in, and they never contain the message.
- Review queue: workouts not done by their due time plus the grace period become missed (or incomplete if started). The worker (`review.sweep`, every 10 minutes) raises "Needs review" items for 2+ missed workouts in 7 days, overdue check-ins and (for coaches who opted in) client messages unread for 24 hours; a sent check-in raises one at once. At `/app/review` the coach filters by state and rule, resolves or dismisses with a reason, snoozes for 1 day, 3 days, 1 week or to a date, messages the client or creates a follow-up. The dashboard shows what needs attention first.
- Each client has private Notes (coaches only, never in any client view) and a History timeline: assignments and program versions, workouts, log changes, check-ins, pauses and notes.
- E2E: `closed-loop.spec.ts` (invite → assign → log → check-in → review → note → resolve) and `journey-d.spec.ts` (the review queue) join the golden path.

## What works locally (Sprint 3)

- Program builder: drafts autosave (to the server, and on the device while offline) and are restored after a reload; "Save changes" creates a new version, a save from a stale tab is a conflict that keeps the draft, and every program has a version history. Weeks can be duplicated and removed, days and exercises reordered, workouts copied to another day; day and exercise notes and per-set tempo are editable. Templates show how many clients use them.
- A client's own program can be edited from their Program tab. Saving applies only to upcoming workouts (completed and started workouts never change); removed weeks cancel their unstarted sessions and added weeks are scheduled after the last one.
- Clients can fix a finished workout's log for 24 hours ("Edited"); coaches can correct a log at any time with a reason (the client sees "Corrected by your coach", never the reason). Every change keeps a revision.
- Pause and resume: "Pause program" on a client moves upcoming workouts forward by the pause length (1-90 days), the portal shows "Program paused" with the expected date, and the program resumes on that date (worker job) or with "Resume now". Changing the resume date or resuming early moves workouts only by the difference.
- Offline workouts: once a workout is started online, the client can log it, complete it, close the page and reopen it with no connection. Every set reads "Saved on device", then "Syncing", then "Synced" once the server has acknowledged everything; nothing is applied twice. A workout that was never started can't be started offline.
- `pnpm test:e2e` runs every spec on the dev server, then `e2e/offline.spec.ts` against a production build (`next build` + `next start` on port 3300, build dir `apps/web/.next-e2e-prod`): the service worker needs stable build assets. Run it alone with `pnpm --filter @kinetic/web exec playwright test -c playwright.offline.config.ts`. Its users are seeded in the database because a production server keeps the breached-password check on.

## What works locally (Sprint 2)

- Client portal home: the next workout with a Start/Continue button, this week's progress ("n of m workouts done"), and a safety reminder until the first workout starts.
- Workouts list with Upcoming and History; each workout opens the logging screen.
- Online workout logging: Start locks the workout version; each set saves when a field loses focus and shows "Syncing", then "Synced" once the server has it; Complete or Skip with an optional comment. Weights are entered and shown in the client's units and stored in kg. Replays and double taps never create duplicates.
- Coaches can log a workout for a client from the client's Sessions tab; both sides see "Logged by coach".
- Coach dashboard with counts (new completed workouts, due this week, skipped this week) and a review list at `/app/review` with "Mark all as seen".
- `apps/web/e2e/golden-path.spec.ts` covers the whole loop (sign-up → invite → program → assign → log → complete → review) and must pass on every PR.

### Sprint 1

- Sign up with a pilot code, verify email, create your coaching organization.
- Exercise library, and a program builder with explicit save (weeks, training days, exercises, sets).
- Clients: add, invite by email (send, resend, revoke), the client accepts and lands in the portal.
- Assign a saved program to an active client from the client's Program tab or the Programs list: pick a start date (default today in the client's time zone), the training days, and confirm readiness on a first assignment. Workouts are scheduled in the client's time zone.
- Replacing an active program asks for confirmation and applies only to upcoming workouts.
- The Program tab shows the current program, start date, training days, session count and the next session.

## Tests

`pnpm test` starts a throwaway embedded Postgres when `DATABASE_URL` is unset in the shell. To use the Docker database instead: `DATABASE_URL=postgresql://kinetic:kinetic@localhost:54320/kinetic pnpm test`.

## Scripts

- `pnpm lint` - ESLint across the repo
- `pnpm typecheck` - TypeScript in every workspace
- `pnpm dev` - web + worker for local development
- `pnpm test` - Vitest unit and integration tests
- `pnpm test:e2e` - Playwright end-to-end tests (web app; the offline spec runs against a production build)
- `pnpm perf:dashboard` - dashboard data-load timing for 50 clients (needs `DATABASE_URL`)
- `pnpm db:up` / `pnpm db:down` - start or stop local Postgres
- `pnpm db:migrate` / `pnpm db:seed` - apply migrations / seed demo data (read the root `.env`)
- `pnpm format` - Prettier (writes; prefer formatting only files you changed)
- `pnpm format:check` - Prettier check on source dirs (CI)

Per-app scripts are documented in `apps/web/README.md`.
