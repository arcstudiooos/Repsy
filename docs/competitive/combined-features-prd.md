# Combined Competitor Features PRD: Repsy R2 candidates

**Status:** Draft v0.1, 2026-10-31. **Proposed**: every feature here needs founder sign-off before a ticket is written.
**Inputs:** [`spurfit-features-prd.md`](spurfit-features-prd.md), public research on ABC Trainerize, Everfit, TrueCoach, Kahunas, TrainHeroic, Hevy Coach, CoachRx, My PT Hub, PT Distinction and FitBudd, and the current Repsy code (`apps/web/src/app/**`, `packages/db/prisma/schema.prisma`) and decisions (`docs/decisions.md`).
**Precedence:** `docs/decisions.md` still wins. Section 3 lists every place this PRD would amend a locked decision.

---

## 0. Method and confidence

- **No competitor accounts were created.** This cloud session's network policy blocks the competitors' domains, sign-up needs a verifiable inbox, and an account in your name on a third-party service should be opened by a person on the team. Findings come from web search over vendor pages, help centers, app-store listings and third-party reviews. Each competitor's row in the matrix is only as good as those sources.
- Tags: **[V]** vendor-stated, **[R]** third-party only, **[I]** inferred. In the matrix: ✅ confirmed, ◐ partial / add-on / higher tier, ✖ absent per sources, ? unknown.
- Several sources are competitor-written comparison posts (FitBudd, QuickCoach, ProMealPlan, Coachway). Treat their prices and verdicts with care.
- **D-008's principle still applies:** "Dropped features return only on validated pilot-coach demand, not speculation." Competitor parity is evidence of market expectation, not of our pilot coaches' needs. Section 7 turns this PRD into pilot interview questions so each priority can be confirmed.

## 1. Competitor snapshots

| Product                                         | Positioning                                                                                                                    | Notable strengths                                                                                                                                                                                                                                                                    | Price signal (verify)                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Spur.fit**                                    | AI co-pilot for coaches                                                                                                        | AI program, meal and habit drafts; leads; branded app; Garmin/Coros                                                                                                                                                                                                                  | Free for 2 clients; Pro $19 (5) to $190 (100) [V]                                                              |
| **ABC Trainerize**                              | Market leader; studios and large rosters                                                                                       | Master Program with workouts, habits and auto-messages scheduled together; phased programs; habits with streaks and badges; groups and challenges; meal plans (add-on); body stats, photos, compliance graphs; Mindbody/Zapier                                                       | Free (1 client) to Studio Plus ~$248. Payments +$10, video +$10, nutrition +$20–45, branded app (one-time) [R] |
| **Everfit**                                     | Workout-first, automation                                                                                                      | **Autoflow** (onboarding and group automation); AI workout builder that turns text into workouts; tasks and habits; forms (Pro); metrics and photos; on-demand collections; packages and payments; forum and leaderboards; team workspace with sub-coaches; voice notes in the inbox | From ~$19. Autoflow +$29, On-demand +$25, Payments +$9 [R]                                                     |
| **TrueCoach**                                   | Simplest 1:1 programming                                                                                                       | Free-form builder (supersets, circuits, intervals, AMRAP); fast duplication; **7/30/90-day compliance per client**; body metrics; photos                                                                                                                                             | ~$19–26 (5), $49–58 (20), $99–107 (50) [R]                                                                     |
| **Kahunas**                                     | Check-in-centric                                                                                                               | Custom check-in forms; **side-by-side check-in comparison**; **photo overlays** (front and side layered); 1.6M-item food database; 1,100+ recipes; lead forms and automations (mid tier)                                                                                             | Essentials $35 (25), Growth $69 (50), Ultimate $99 (unlimited, branded app) [R]                                |
| **TrainHeroic**                                 | Teams and athletes                                                                                                             | **5-question readiness survey** before each session; readiness score on the coach dashboard; team **leaderboards**; session volume and intensity summaries                                                                                                                           | —                                                                                                              |
| **Hevy Coach**                                  | Built on the Hevy logger                                                                                                       | Client management, workout assignment and tracking on a well-liked consumer logger. Reviewers note a limited library and no body-stat updates in the app                                                                                                                             | ~$25/mo [R]                                                                                                    |
| **CoachRx, My PT Hub, PT Distinction, FitBudd** | Assessments (CoachRx); scheduling (My PT Hub); automation and analytics (PT Distinction); branded app and storefront (FitBudd) | Search returned little feature detail. Covered in the matrix only where sourced                                                                                                                                                                                                      | —                                                                                                              |

## 2. Feature matrix

Repsy column: ✅ shipped (Sprints 1–5), ✖ not built, ◐ partial.

| #    | Capability                                   | Spur                   | Trainerize  | Everfit             | TrueCoach        | Kahunas       | TrainHeroic      | **Repsy**                       |
| ---- | -------------------------------------------- | ---------------------- | ----------- | ------------------- | ---------------- | ------------- | ---------------- | --------------------------------- |
| —    | Program builder (weeks/days/exercises/sets)  | ✅                     | ✅          | ✅                  | ✅               | ✅            | ✅               | ✅ (versioned, autosaved drafts)  |
| —    | Templates assigned to clients                | ✅                     | ✅          | ✅                  | ✅               | ✅            | ✅               | ✅ (copy-on-assign)               |
| —    | Workout logging                              | ✅                     | ✅          | ✅                  | ✅               | ✅            | ✅               | ✅ (offline, idempotent)          |
| —    | Weekly check-ins                             | ✅                     | ✅          | ✅                  | ◐                | ✅            | ◐                | ✅ (1 template, 3 question types) |
| —    | 1:1 messaging                                | ✅                     | ✅          | ✅                  | ✅               | ✅            | ✅               | ✅ (text only)                    |
| —    | Attention queue                              | ?                      | ◐           | ◐                   | ◐                | ?             | ◐                | ✅ (rules, snooze, resolve)       |
| F-01 | Body metrics and charts                      | ✅                     | ✅          | ✅                  | ✅               | ✅            | ?                | ✖                                 |
| F-02 | Progress photos and compare                  | ✅                     | ✅          | ✅                  | ✅               | ✅ (overlay)  | ?                | ✖                                 |
| F-03 | Exercise demo video                          | ✅ (YouTube/IG import) | ✅          | ✅                  | ✅               | ✅            | ✅               | ◐ (`mediaUrl` only)               |
| F-04 | Supersets / circuits / intervals / AMRAP     | ✅                     | ✅          | ✅                  | ✅               | ?             | ✅               | ✖                                 |
| F-05 | Habits / tasks with streaks                  | ✅ (heat map)          | ✅ (badges) | ✅                  | ?                | ✅            | ?                | ✖                                 |
| F-06 | Custom forms / multiple templates / intake   | ✅                     | ✅          | ◐ (Pro)             | ?                | ✅            | ✅               | ◐                                 |
| F-07 | Reminders / push notifications               | ✅                     | ✅          | ✅                  | ✅               | ✅            | ✅               | ✖ (D-008 #10)                     |
| F-08 | Media in chat, voice notes, workout comments | ✅                     | ✅          | ✅ (voice)          | ✅               | ✅            | ✅               | ✖ (D-008 #1)                      |
| F-09 | PRs and exercise history                     | ✅ (lifts)             | ✅          | ✅                  | ✅               | ?             | ✅               | ✖                                 |
| F-10 | Group / bulk assignment, client tags         | ✅                     | ✅          | ✅                  | ✅               | ?             | ✅ (teams)       | ✖ (D-008 #3)                      |
| F-11 | Nutrition (macros, meal plans, logging)      | ✅ (AI)                | ◐ (add-on)  | ◐                   | ✖ (integrations) | ✅            | ✖                | ✖                                 |
| F-12 | Automation sequences                         | ✅                     | ✅          | ◐ (Autoflow add-on) | ?                | ◐ (mid tier)  | ?                | ✖                                 |
| F-13 | Payments / packages                          | ✅                     | ◐ (add-on)  | ◐ (add-on)          | ✅               | ✅            | ✅               | ✖ (D-008 #12)                     |
| F-14 | Lead capture / pipeline                      | ✅                     | ◐           | ?                   | ✖                | ◐             | ✖                | ✖                                 |
| F-15 | Team / multi-coach                           | ◐                      | ✅          | ✅                  | ✅               | ✅ (Ultimate) | ✅               | ◐ (`owner`/`coach` roles exist)   |
| F-16 | Community / challenges / leaderboards        | ?                      | ✅          | ✅                  | ✖                | ?             | ✅               | ✖                                 |
| F-17 | Readiness survey                             | ?                      | ✖           | ✖                   | ✖                | ✖             | ✅               | ✖                                 |
| F-18 | 7/30/90-day compliance per client            | ?                      | ✅ (graphs) | ?                   | ✅               | ?             | ✅               | ◐ (org-level analytics)           |
| F-19 | Wearables / health sync                      | ✅                     | ✅          | ✅                  | ◐                | ?             | ?                | ✖                                 |
| F-20 | Native and branded app                       | ✅                     | ◐ (paid)    | ◐                   | ✖                | ◐ (Ultimate)  | ✅               | ✖ (web portal)                    |
| F-21 | On-demand content                            | ?                      | ✅          | ◐ (add-on)          | ?                | ?             | ✅ (marketplace) | ✖                                 |
| F-22 | Calendar / appointments / video              | ?                      | ✅          | ?                   | ?                | ?             | ?                | ✖                                 |
| F-23 | AI drafting                                  | ✅ (core)              | ?           | ✅                  | ✖                | ?             | ?                | ✖ (D-007 rule)                    |
| F-24 | Storefront / marketplace                     | ?                      | ◐           | ◐                   | ✖                | ?             | ✅               | ✖                                 |

**Read-out:** F-01, F-02, F-03, F-04, F-07, F-08 and F-09 are table stakes: every competitor with data has them, and a prospect will notice their absence in a demo. F-11, F-12 and F-13 are where competitors make money (they are sold as add-ons). Spur.fit's moat is F-23 (AI), and Kahunas's is F-02/F-06 (check-in depth). Repsy's own strengths (versioned programs, offline logging with an honest sync state, the attention queue, privacy workflows) are not matched in any source we found. Keep them as our positioning.

## 3. Decisions this PRD would amend

Each row needs a founder ruling, recorded as a new `D-011+` entry in `docs/decisions.md` before work starts.

| Locked rule                                                              | Features affected | Proposed amendment                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global Constraints / D-007: "No AI features, no generated health advice" | F-23              | Keep "no generated health advice to clients." Allow **coach-only drafting assistants** whose output is always a draft the coach must edit and save; nothing AI-generated reaches a client without a coach's explicit save. Behind a per-organization toggle, off by default.      |
| D-007: no injury or medical-history fields                               | F-06, F-17        | Keep it. Custom forms ship **without** medical question templates, and the builder warns against asking for diagnoses. Readiness survey items are limited to sleep, energy, soreness, stress and mood (wellbeing, already in scope as F09 data). Counsel review because of MHMDA. |
| D-008 #1: text-only messaging, no attachments                            | F-08              | Allow image, short video (≤60 s) and voice note (≤2 min) attachments, stored privately with requester-only signed URLs (same pattern as exports). Messages stay immutable.                                                                                                        |
| D-008 #3: individual assignments only                                    | F-10              | Allow **bulk assign** that creates individual copy-on-assign assignments (D-001 unchanged), one per client. There is no shared "group program" object.                                                                                                                            |
| D-008 #9: one check-in template                                          | F-06              | Several form templates per org; each client gets one recurring check-in plus optional one-off forms.                                                                                                                                                                              |
| D-008 #10: no scheduled reminders                                        | F-07              | Allow opt-in reminders (workout day morning, check-in due evening) by email and web push. Respect quiet hours in the client's time zone.                                                                                                                                          |
| D-008 #12: billing outside the app                                       | F-13              | Stripe Connect (Standard) for coaches charging clients. Repsy's own billing of coaches is a separate decision.                                                                                                                                                                  |
| D-008 #13: 30 active clients per coach                                   | F-15              | Unchanged for the pilot. Revisit at GA pricing.                                                                                                                                                                                                                                   |
| §2.3: native app is R2                                                   | F-19, F-20        | Confirm R2 or R3 timing. F-19 depends on F-20.                                                                                                                                                                                                                                    |

## 4. Combined screen inventory, mapped to Repsy routes

**Existing** = the route exists today. **Extend** = add to an existing route. **New** = new route.

### 4.1 Coach (`/app`)

| Screen (seen across competitors)                                    | Repsy route                                      | Status                                                                          | Features               |
| ------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| Dashboard: attention, due, activity                                 | `/app`                                             | Extend: readiness alerts, PRs this week, revenue tile (F-13)                    | F-09, F-13, F-17       |
| Clients list with compliance and tags                               | `/app/clients`                                     | Extend: 7/30/90 compliance columns, tags filter, sort by attention, bulk select | F-10, F-18             |
| Client profile: Overview                                            | `/app/clients/[id]`                                | Extend: metric sparkline, latest photo, compliance, habits streak               | F-01, F-02, F-05, F-18 |
| Client: Program / Sessions / Check-ins / Messages / Notes / History | `/app/clients/[id]/*`                              | Existing                                                                        | —                      |
| Client: **Progress** (metrics, photos, PRs)                         | `/app/clients/[id]/progress`                       | New                                                                             | F-01, F-02, F-09       |
| Client: **Habits**                                                  | `/app/clients/[id]/habits`                         | New                                                                             | F-05                   |
| Client: **Nutrition**                                               | `/app/clients/[id]/nutrition`                      | New                                                                             | F-11                   |
| Client: **Billing**                                                 | `/app/clients/[id]/billing`                        | New                                                                             | F-13                   |
| Program builder with blocks (superset/circuit)                      | `/app/programs/[id]/edit`                          | Extend                                                                          | F-04                   |
| Exercise library with video                                         | `/app/exercises`                                   | Extend: video preview, YouTube/Vimeo embed, upload                              | F-03                   |
| Forms library and form builder                                      | `/app/check-ins` → `/app/forms`, `/app/forms/[id]` | Extend and rename                                                               | F-06                   |
| Check-in review with side-by-side comparison                        | `/app/clients/[id]/check-ins`                      | Extend: compare to any earlier check-in, photo compare                          | F-02, F-06             |
| Habits library                                                      | `/app/habits`                                      | New                                                                             | F-05                   |
| Automations                                                         | `/app/automations`, `/app/automations/[id]`        | New                                                                             | F-12                   |
| Leads pipeline                                                      | `/app/leads`                                       | New                                                                             | F-14                   |
| Packages and payments                                               | `/app/payments`                                    | New                                                                             | F-13                   |
| Nutrition library (meal plans, recipes)                             | `/app/nutrition`                                   | New                                                                             | F-11                   |
| Team                                                                | `/settings` (Team section)                         | Extend                                                                          | F-15                   |
| Groups / community                                                  | `/app/community`                                   | New (R3)                                                                        | F-16                   |
| Calendar                                                            | `/app/calendar`                                    | New (R3)                                                                        | F-22                   |
| AI draft panel                                                      | inside `/app/programs/[id]/edit`                   | New (gated)                                                                     | F-23                   |

### 4.2 Client (`/portal`)

| Screen                                             | Repsy route                                      | Status                                                                               | Features               |
| -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------- |
| Home / Today: workout, habits, check-in, readiness | `/portal`                                          | Extend: today's habits checklist, readiness prompt, reminders opt-in                 | F-05, F-07, F-17       |
| Workouts list and logger                           | `/portal/workouts`, `/portal/workouts/[sessionId]` | Extend: video demo, previous performance, PR badge, rest timer, blocks, set comments | F-03, F-04, F-08, F-09 |
| Check-ins / forms                                  | `/portal/check-ins/[id]`                           | Extend: new question types, photo and metric questions                               | F-02, F-06             |
| **Progress**: metrics, photos, PRs                 | `/portal/progress`                                 | New                                                                                  | F-01, F-02, F-09       |
| **Habits**                                         | `/portal/habits`                                   | New, or a section on Home                                                            | F-05                   |
| **Nutrition**                                      | `/portal/nutrition`                                | New                                                                                  | F-11                   |
| Messages with attachments                          | `/portal/messages`                                 | Extend                                                                               | F-08                   |
| Profile: units, notifications, consent             | `/portal/profile`                                  | Extend: notification preferences, push opt-in                                        | F-07                   |
| Billing                                            | `/portal/billing`                                  | New                                                                                  | F-13                   |
| Public intake / checkout page                      | `/join/[orgSlug]`                                  | New (unauthenticated)                                                                | F-13, F-14             |

## 5. Feature specifications

Priority: **P0** = table stakes for R2. **P1** = growth and retention. **P2** = larger bets. **P3** = later.
Effort: S ≤1 week, M 1–2 weeks, L 3–4 weeks, XL >1 month (one agent-driven slice, including tests and docs per D-009 rule 3).
All features inherit the Global Constraints: tenant scoping with `organization_id`, the API envelope, idempotency, 375/768/1440 layouts, WCAG 2.2 AA, analytics without names or free text, and audit events without content.

---

### F-01 Body metrics and progress charts — P0, M

**Seen in:** all six. **Why:** coaches and clients expect to see change over time. It is also the lowest-risk progress feature.
**User stories**

- As a coach, I choose which metrics a client tracks (weight, body-fat %, waist, hips, chest, arm, thigh, resting HR, steps, or a custom metric with a unit) and see a chart per metric.
- As a client, I log a metric from Progress or inside a check-in, in my preferred units, and see my trend.
  **Requirements**

1. Metric catalog: built-in metrics plus org-defined custom metrics (`name`, `unit_kind`: mass/length/percent/count/bpm/none, `decimals`).
2. Entries: `{client_id, metric_id, value_canonical, measured_on (client-local date), source: client|coach|checkin, created_by}`. Canonical storage in kg/cm, displayed in the user's units (reuse `packages/core/src/units.ts`).
3. Charts: the last 4/12/26/52 weeks; a table view as the accessible alternative (the chart is never the only representation).
4. Coach corrections follow the set-log pattern: an append-only revision with a reason.
5. Export: included in the client and org CSV exports (S5-2).
   **Screens:** `/app/clients/[id]/progress` (metric cards, chart, table, add-entry dialog); `/portal/progress`.
   **Data:** new `metric_definitions`, `metric_entries`, `metric_entry_revisions`.
   **Acceptance**

- Weight 180 lb is stored as 81.65 kg and shows as 180 lb to a lb user and 81.6 kg to a kg user.
- A coach of org A cannot read org B entries (RLS test).
- A zero-entry state reads "No entries yet", not an empty chart.
- Deletion (S5-3) erases the entries.
  **Decisions:** none. Check whether any custom metric could be medical (for example, blood glucose). Propose a blocked-word warning plus counsel review.

### F-02 Progress photos with side-by-side and overlay compare — P0, L

**Seen in:** all six. Kahunas's **overlay** is the standout.
**User stories**

- As a client, I upload front, side and back photos (from Progress or a check-in question) and see my own gallery.
- As a coach, I compare any two dates side by side or as an overlay with an opacity slider, per pose.
  **Requirements**

1. Upload: JPEG/PNG/HEIC up to 15 MB, converted server-side to WebP. EXIF (including GPS) stripped. Stored in private storage (`packages/storage`) and served through short-lived signed URLs to the client and their coaches only.
2. Pose tag: front, side, back or other. `taken_on` is a client-local date.
3. Compare view: pick a date A and B per pose. Modes: side by side, overlay (opacity slider), swipe. Keyboard operable.
4. Privacy: an explicit photo consent step the first time (versioned like `consent_version`). The client can delete their own photo, which writes a content-free audit event. Never in analytics, never in emails, never in push payloads.
5. Support access (S5-3) does **not** include photos unless that is explicitly granted.
   **Screens:** `/app/clients/[id]/progress` (Photos tab: grid by date, compare mode); `/portal/progress` (Photos); a check-in photo question (F-06).
   **Data:** `progress_photos {id, organization_id, client_id, pose, taken_on, storage_key, width, height, uploaded_by, deleted_at}`.
   **Acceptance**

- Uploaded files carry no EXIF GPS (test).
- A signed URL for one client's photo returns 403 for a coach of another org and after 15 minutes.
- Erasure removes the objects from storage.
  **Decisions:** D-007 / MHMDA. Photos are sensitive, so counsel must review before launch.

### F-03 Exercise media: demo video in library and logger — P0, S–M

**Seen in:** all. Spur.fit imports from **YouTube and Instagram**.
**Requirements**

1. `Exercise.mediaUrl` accepts YouTube, Vimeo and Instagram links (allowlisted hosts, rendered as privacy-enhanced embeds such as `youtube-nocookie.com`) or a coach-uploaded MP4 (≤100 MB, private storage).
2. Thumbnail preview in `/app/exercises` and in the builder picker.
3. In the logger, a "Demo" button on each exercise opens an accessible dialog with the player and instructions. When the client is offline, show the instructions only and say "Video needs a connection."
4. The seeded catalog gets demo links where licensing allows. Otherwise it stays text-only.
   **Acceptance:** a non-allowlisted URL is rejected with a field error. The embed iframe has a title. The logger works offline without the video.

### F-04 Workout structure: supersets, circuits, intervals, AMRAP/EMOM, rest timer — P0, L

**Seen in:** TrueCoach (free-form), Trainerize, Everfit, TrainHeroic, Spur.fit (tempo and rest).
**Requirements**

1. A **block** layer inside a workout version: `straight` (today's behavior), `superset` (2–4 exercises alternating), `circuit` (N rounds of M exercises), `interval` (work/rest seconds × rounds), `amrap` (time cap, score = rounds + reps), `emom` (minutes × exercises).
2. Per exercise: rest seconds (the target schema already carries tempo). The block carries rounds and rest between rounds.
3. Logger: groups exercises by block with labels (A1/A2), a rest timer that starts after a set is saved (vibrates where supported, honors reduced-motion), and an AMRAP/EMOM score entry.
4. **Immutability:** blocks are part of the workout version (D-002). Changing a block makes a new version. Locked sessions keep their structure.
5. Offline: block metadata is cached with the version (D-004).
   **Data:** `workout_version_blocks {id, workout_version_id, position, kind, rounds, work_s, rest_s, time_cap_s}`; `workout_version_exercises.block_id`. Migration: every existing exercise goes into its own `straight` block.
   **Acceptance:** existing versions render unchanged after the migration. A superset logs A1 and A2 sets interleaved. Score entry is idempotent (Review Focus #2).
   **Risk:** the largest change to the core model. Needs its own `writing-plans` pass.

### F-05 Habits and tasks with streaks and a coach heat map — P0, M

**Seen in:** Spur.fit (heat map, "habit gaps"), Trainerize (streaks, badges), Everfit (tasks), Kahunas.
**Requirements**

1. Habit library per org: `name`, `frequency` (daily, or N days per week), optional target (for example, "8 glasses"), and optional assignment start and end dates.
2. Client: a checklist on `/portal` (today) and `/portal/habits` (week view). Logging the past 2 days is allowed. Current and best streak are shown.
3. Coach: a per-client heat map (12 weeks × 7 days, with a text alternative) and a completion % per habit.
4. Review rule (opt-in per coach): "Habit completion under 50% for 2 weeks" raises **Needs review** (F10 copy).
5. One-off **tasks** ("Upload your gym's equipment list") with a due date, done or not done.
   **Data:** `habits`, `habit_assignments`, `habit_logs {assignment_id, local_date, value}` (unique per assignment and date); `tasks`.
   **Acceptance:** a DST-boundary test (Review Focus #1) proves that a local date tick near midnight lands on the client's day. A double tap writes one log.

### F-06 Forms v2: multiple templates, richer question types, intake — P0, M

**Seen in:** Kahunas (core), Spur.fit (intake forms, lead statuses), Everfit (Pro), Trainerize.
**Requirements**

1. Many templates per org (D-008 #9 amendment). Kinds: `recurring_checkin`, `one_off`, `intake`.
2. New question types besides scale, short text and yes/no: long text, number (with unit), single and multiple choice, date, **metric** (writes an F-01 entry), **photo** (writes an F-02 photo).
3. Assignment: each client has one recurring check-in (as today). A one-off form can be sent at any time. An intake form is attached to the invite (F-04 onboarding) or a public lead form (F-14).
4. Comparison: the coach review shows the answer next to **any** earlier check-in (not just last week). Metrics show their deltas.
5. No medical template library (D-007). The builder shows a hint: "Don't ask for diagnoses or medical history. Ask clients to tell you privately about anything relevant to safe training."
   **Data:** extend `checkin_templates` (add `kind`, versioned `questions_json`); `checkins.template_version`; answers keyed by question id.
   **Acceptance:** old check-ins render with the question text they were sent with (immutability). A metric question produces exactly one metric entry, even on resubmit.

### F-07 Reminders and push notifications — P0, M

**Seen in:** all.
**Requirements**

1. Channels: email (exists) and **web push** (VAPID, service worker already present for offline). Native push arrives with F-20.
2. Client reminders (each opt-in, default on after the client agrees): workout day at a chosen time (default 07:00 local), check-in due at 18:00 local if not submitted, habit nudge (optional).
3. Coach notifications: new message, check-in submitted, Needs review raised (digest option).
4. Quiet hours 21:00–07:00 client-local. At most 3 pushes per client per day.
5. Payloads carry no content: "You have a new message", never the text (same rule as email).
6. Jobs in the worker (`reminders.dispatch`), idempotent per (user, kind, local_date).
   **Acceptance:** no reminder during a pause (D-003). No duplicate after a worker restart. The unsubscribe link and the toggle both work.

### F-08 Rich messaging: images, video, voice notes, workout comments — P0/P1, M

**Seen in:** all. Everfit has voice notes. Spur.fit has form-check video.
**Requirements**

1. Attachments: image (≤15 MB), video (≤60 s / 100 MB), voice (≤2 min). Private storage, signed URLs, EXIF stripped. Messages stay immutable (no edit or delete). The client can request deletion through privacy flows.
2. **Workout comments:** a thread anchored to a session (and optionally to one exercise). The client adds a comment from the logger. The coach replies from the session detail. Shown in the main thread with a "Re: Upper A, Tue 3 Nov" chip.
3. Offline: attachments queue in the outbox and upload when the client is back online, using the same "Saved on device → Syncing → Synced" states.
   **Acceptance:** an attachment URL from another org returns 403. A voice note has a transcript slot (empty in R2) and accessible controls.

### F-09 Personal records and exercise history — P0, S–M

**Seen in:** most. Hevy's core strength.
**Requirements**

1. Computed per client per exercise: best estimated 1RM (Epley, labeled "estimated"), heaviest weight at each rep count from 1 to 10, best volume session, longest duration or distance.
2. Logger: "Last time: 3 × 8 @ 60 kg" under each exercise, from the most recent completed session. A PR badge appears when a saved set beats a record.
3. History view: per-exercise chart and list on `/portal/progress` and `/app/clients/[id]/progress`.
4. Coach corrections (revisions) recompute records. A record never counts a set from a skipped session.
   **Data:** derived, computed on read with an index on `set_logs (client_id, exercise_id)`. Add a materialized `personal_records` table only if `perf:dashboard`-style timing says it is needed.
   **Acceptance:** a correction that lowers a weight removes the PR badge. Units round-trip (Review Focus #5).

### F-10 Bulk assignment and client tags — P1, M

**Seen in:** all (groups, teams).
**Requirements**

1. Tags on clients (org-defined, colored). Filter the client list by tag.
2. Bulk actions in the client list: assign a program (creates individual copy-on-assign assignments; the existing readiness confirmation applies to each first assignment), send a one-off form, add a tag, send a message (one message per thread, not a group chat).
3. A preview and confirm dialog lists every client and any conflict ("has an active program, will be replaced on upcoming workouts only").
   **Acceptance:** assigning to 25 clients is one idempotent request. A partial failure reports which clients succeeded. History shows each client's assignment.

### F-11 Nutrition: targets, meal plans, simple logging — P1, L

**Seen in:** Spur.fit (AI meal plans, recipes, logging), Kahunas (1.6M-food database, 1,100+ recipes), Trainerize (add-on, MyFitnessPal), Everfit (macros).
**Phasing**

- **11a (M):** daily targets (calories, protein, carbs, fat, optionally fiber and water) per client with effective dates. The client logs daily totals (manually, or from F-19 later). Adherence uses the same ± band as competitors' "hit your macros" displays.
- **11b (M):** meal plans as structured days × meals (free text plus macros) **or** an uploaded PDF. Recipe library per org.
- **11c (L):** food search with a licensed food database (evaluate USDA FoodData Central, which is public domain, or Open Food Facts, which is ODbL, before any paid API) and a barcode scanner (camera API; requires a native app or a well-supported web API).
  **Constraints:** no medical diets or claims (D-007). The copy says "targets set by your coach."
  **Screens:** `/app/clients/[id]/nutrition`, `/app/nutrition` (library), `/portal/nutrition`.

### F-12 Automation sequences (Autoflow-style) — P1, L

**Seen in:** Everfit Autoflow (+$29), Trainerize auto-messages inside Master Programs, Kahunas automations, Spur.fit nudges.
**Requirements**

1. A sequence is ordered steps relative to the client's **start date** (day 0, 1, 7…) or to an event (invite accepted, program finished, check-in submitted, package purchased).
2. Step types: send a message (from a template with `{first_name}` only), send a form, assign a habit or task, assign a program (with readiness confirmation captured up front), add a tag, create a coach follow-up (review item).
3. Enrolment: manually, through bulk (F-10), through a package purchase (F-13) or through a lead conversion (F-14). Pausing a client pauses the sequence (D-003).
4. Audit: every executed step is visible in the client's History.
5. Worker job `automations.run`, idempotent per (enrolment, step).
   **Acceptance:** a message step never sends twice after a restart. A paused client's day-7 step runs on day 7 + pause length.

### F-13 Payments and packages (Stripe Connect) — P1, L

**Seen in:** all (mostly as add-ons).
**Requirements**

1. A coach connects Stripe (Standard Connect). Repsy never holds funds. Platform fee is 0% in R2 (pricing decision).
2. Packages: one-off or recurring (weekly, monthly), with a price, currency, description and optional trial. Optional on purchase: invite the client, enrol a sequence (F-12), assign a program template.
3. A public checkout page per package at `/join/[orgSlug]/[package]` uses Stripe Checkout. Webhooks are idempotent through stored event ids.
4. Client billing view: current plan, next charge, Stripe Customer Portal link for card changes and cancellation.
5. Failed payment: optional Needs review item and an optional client-access grace period (coach setting).
   **Decisions:** D-008 #12 amendment, tax and VAT handling (Stripe Tax?), refunds through Stripe only.

### F-14 Lead capture and pipeline — P1, M

**Seen in:** Spur.fit (forms and lead statuses), Kahunas (lead forms), PT Distinction.
**Requirements**

1. A public intake form (F-06 `intake` kind) at `/join/[orgSlug]` with consent text, rate limiting and a CAPTCHA-free honeypot.
2. Leads board: New → Contacted → Call booked → Won / Lost, with notes. "Convert to client" sends the invite with the intake answers attached.
3. Leads are personal data: covered by export and deletion. A retention setting auto-deletes lost leads after N days.

### F-15 Team workspace — P1, M

**Seen in:** Everfit (sub-coach, admin inbox, transfer), Trainerize, Kahunas (Ultimate), TrueCoach.
**Today:** `MembershipRole` has `owner`, `coach` and `client`.
**Requirements**

1. A client has a primary coach (`clients.primary_coach_membership_id`). The client list defaults to "My clients", with an "All clients" view for the owner.
2. Transfer a client to another coach (audited). The thread history stays.
3. Owner admin inbox: read-only view of every thread (configurable per org, disclosed to clients in the privacy notice).
4. Per-coach analytics and the 30-client limit enforced per coach (D-008 #13).

### F-16 Community: groups, challenges, leaderboards — P2, L

**Seen in:** Trainerize (groups, challenges), Everfit (forum, leaderboards linked to forums), TrainHeroic (team leaderboards).
**Requirements:** group feed per tag or cohort (posts, comments, reactions; the coach moderates), time-boxed challenges (habit or metric based, opt-in leaderboard with display names only), reporting and muting. **Privacy:** leaderboards are opt-in. Body metrics are never ranked by default.

### F-17 Readiness survey before a workout — P1, S

**Seen in:** TrainHeroic (5 questions; readiness score on the coach dashboard).
**Why it fits Repsy:** it feeds the attention queue we already have.
**Requirements**

1. An optional per-client toggle. On **Start**, the client answers five 1–5 items (sleep, energy, soreness, stress, mood). Skippable.
2. Readiness score = mean × 20 (0–100), shown on the session detail and the coach dashboard.
3. Review rule (opt-in): readiness ≤ 40 on two consecutive sessions raises **Needs review**. The copy never suggests a medical meaning.
4. Works offline: answers save with the session outbox.

### F-18 Per-client compliance (7/30/90 days) — P0, S

**Seen in:** TrueCoach (7/30/90 per client), Trainerize (weekly compliance graphs).
**Requirements:** reuse `packages/core/src/analytics/adherence.ts` per client for rolling 7/30/90-day windows, with the same numerator/denominator rules (paused and cancelled excluded, "No sessions due yet" for zero). Add sortable columns to `/app/clients` and a mini trend on the client Overview. Optionally add check-in response rate and habit completion.
**Acceptance:** matches the org-level analytics totals when summed. Pause exclusion is tested.

### F-19 Wearables and health data sync — P2, XL

**Seen in:** Spur.fit (Apple Health, Garmin, Coros), Trainerize (Apple Health, Garmin, Fitbit, Withings), Everfit (Apple Health, Google Fit, Garmin, Fitbit).
**Needs:** F-20 for HealthKit and Health Connect. Garmin and Fitbit use server-side OAuth APIs (partner approval required).
**Scope:** read-only import of steps, workouts (cardio sessions matched to scheduled ones), resting HR, sleep duration, weight → F-01 entries with `source: device`. Explicit per-data-type consent. Revocable.

### F-20 Native and branded mobile app — P2, XL

**Seen in:** all (branding is usually a paid tier).
**Approach options:** (a) improve the PWA first: installable, web push (F-07), offline already done; (b) a Capacitor or Expo shell around the portal; (c) white-label builds per coach (store accounts, review overhead). Recommendation: (a) in R2, then (b) when F-19 is approved, then (c) only as a paid tier.

### F-21 On-demand content library — P2, M

**Seen in:** Trainerize, Everfit (On-demand add-on), TrainHeroic (marketplace).
**Scope:** collections of workouts or videos a client can start at any time, outside the schedule. Their logs count toward history but not adherence.

### F-22 Calendar, appointments and video sessions — P2, M–L

**Seen in:** Trainerize, My PT Hub (scheduling, attendance).
**Scope:** coach availability, bookable 1:1 slots, ICS feed, a video-call link field (no built-in video in R2).

### F-23 AI drafting assistant (coach-only) — Decision required, L

**Seen in:** Spur.fit (core: programs, meal plans, recipes, habit micro-plans, nudges), Everfit (text → structured workout).
**Proposed guard-rails if approved (see §3):**

1. **Coach-only.** Output always lands as an unsaved **draft** in the existing program builder (`ProgramDraft`). The coach must review and press "Save changes." Nothing AI-generated is ever sent to a client automatically.
2. First use case: **"Paste a workout"**, which turns free text or a spreadsheet paste into structured weeks, days, exercises and sets, matched to the coach's exercise library (Everfit's most-praised AI feature, with the lowest safety risk).
3. Second: "Draft a program like my template X for these parameters."
4. Never: diagnoses, injury advice, supplement or medical-diet advice, or client-facing chat.
5. Inputs are minimized (no client names, no free-text check-in answers unless the coach pastes them). The provider goes behind a `packages/core` port (no SDK in core). Per-org toggle, off by default. Prompts and outputs are not used for training.
6. Labeled "Draft created with AI. Review before saving."

### F-24 Storefront and marketplace — P3

**Seen in:** TrainHeroic (marketplace), FitBudd (storefront), Trainerize and Everfit (packages). Depends on F-13 and F-21.

## 6. Proposed release plan (subject to pilot validation)

| Release  | Contents                                  | Theme                                                                              | Est.        |
| -------- | ----------------------------------------- | ---------------------------------------------------------------------------------- | ----------- |
| **R2a**  | F-18, F-09, F-03, F-01, F-07              | "See progress, get reminded." Low risk, high parity, no amendment except D-008 #10 | ~5–6 weeks  |
| **R2b**  | F-04, F-02, F-06, F-08, F-17              | "Deeper coaching loop": blocks, photos, forms, rich chat, readiness                | ~8–10 weeks |
| **R2c**  | F-05, F-10, F-15                          | "Scale the roster"                                                                 | ~4–5 weeks  |
| **R3a**  | F-13, F-14, F-12                          | "Run the business": payments, leads, automation                                    | ~8 weeks    |
| **R3b**  | F-11 (a, b), F-23 (if approved)           | Nutrition and AI drafting                                                          | ~6–8 weeks  |
| **R3c+** | F-20, F-19, F-16, F-21, F-22, F-11c, F-24 | Native, wearables, community, content                                              | TBD         |

Each release keeps the golden-path E2E green, adds an E2E for its new loop, and gets a `writing-plans` pass that produces step-level tickets in `docs/superpowers/plans/`.

## 7. Validation with pilot coaches (D-008 principle)

Ask each pilot coach (the time-on-task protocol in `docs/pilot/` can host this):

1. Which tool did you use before Repsy? What do you miss from it? (Map answers to the F-numbers.)
2. Rank: progress photos, body metrics, habits, nutrition targets, reminders, payments, AI drafting.
3. How do you collect progress photos today? (WhatsApp? Email?) That shows how big the F-02 privacy risk is in practice.
4. Would you use AI to turn a pasted workout into a program, if you always review it before saving? Would your clients mind?
5. How do you take payment today? Would you move it into Repsy at a 0% platform fee?
   Promote a feature from Proposed to a sprint ticket when **≥3 pilot coaches** rank it top-3, or when a blocking objection in a sales demo names it.

## 8. Hands-on verification (for a team member)

For each of Trainerize (free plan), Everfit (trial), TrueCoach (trial), Kahunas (trial) and Spur.fit (Starter): sign up with a team test inbox, invite a second test inbox as the client, and screenshot each screen in §4 into `docs/competitive/screens/<product>/` (no real personal data). Record the task timings that matter most to us: build a 4-week program, assign it, log a workout as the client, review a check-in. Then update the matrix tags here from [R]/[I] to verified.

## Sources

**Spur.fit:** see [`spurfit-features-prd.md`](spurfit-features-prd.md#sources).

**ABC Trainerize:** [Getting Started Overview (help)](https://help.trainerize.com/hc/en-us/articles/208688876-What-is-ABC-Trainerize-A-Getting-Started-Overview) · [Phased programs (help)](https://help.trainerize.com/hc/en-us/articles/115004404763-What-is-a-Phased-Program-and-How-to-Build-One) · [Blog: nutrition coaching](https://www.trainerize.com/blog/abc-trainerize-for-nutrition-coaching/) · [Blog: automate your business](https://www.trainerize.com/blog/how-to-automate-your-business/) · [Blog: what is ABC Trainerize](https://www.trainerize.com/blog/what-is-abc-trainerize/) · [ProMealPlan review](https://www.promealplan.com/en/blog/trainerize-review-2026) · [PT Pioneer review](https://www.ptpioneer.com/personal-training/tools/trainerize-review/) · [Coachway pricing](https://coachway.io/articles/trainerize-pricing/) · [Costbench pricing](https://costbench.com/software/gym-management/trainerize/) · [Costbench May 2026 change](https://costbench.com/changelog/trainerize-price-decrease-2026-05/) · [FitBudd pricing explainer](https://www.fitbudd.com/insights/trainerize-pricing-explained-what-it-actually-costs-trainers-in-2026-vs-better-alternatives)

**Everfit:** [Pricing](https://everfit.io/pricing/) · [AI Suite](https://everfit.io/ai-suite/) · [Help: client app overview](https://help.everfit.io/en/articles/3652416-client-app-overview) · [Help: client onboarding walkthrough](https://help.everfit.io/en/articles/5555389-onboarding-walkthrough-for-client) · [Help: inbox messaging](https://help.everfit.io/en/articles/2972174-inbox-messaging) · [Help: forum](https://help.everfit.io/en/articles/4853679-introducing-forum) · [Help: team features](https://help.everfit.io/en/collections/1789337-team-features) · [ProMealPlan review](https://www.promealplan.com/en/blog/everfit-review-2026) · [Coachway review](https://coachway.io/articles/everfit-review/) · [G2 reviews](https://www.g2.com/products/everfit/reviews) · [SaaSworthy pricing](https://www.saasworthy.com/product/everfit-io/pricing)

**TrueCoach:** [Software Advice](https://www.softwareadvice.com/personal-trainer/truecoach-profile) · [ProMealPlan review](https://www.promealplan.com/en/blog/truecoach-review-2026) · [Makerstack review](https://makerstack.co/reviews/truecoach-review/) · [Coachway review](https://coachway.io/articles/truecoach-review/) · [Capterra reviews](https://www.capterra.ca/reviews/155784/truecoach)

**Kahunas:** [kahunas.io](https://kahunas.io/) · [Coachway review](https://coachway.io/articles/kahunas-review/) · [Coachway pricing](https://coachway.io/articles/kahunas-pricing/) · [ProMealPlan review](https://www.promealplan.com/en/blog/kahunas-review-2026) · [Capterra pricing](https://www.capterra.com/p/10028886/Kahunas/pricing/) · [GetApp](https://www.getapp.com/personal-trainer-software/a/kahunas)

**TrainHeroic / Hevy Coach / CoachRx:** [TrainHeroic support: readiness survey](https://support.trainheroic.com/hc/en-us/articles/18156631592589) · [TrainHeroic: Coach Home](https://www.trainheroic.com/?p=6153) · [Capterra: Hevy Coach](https://www.capterra.com/p/10015732/Hevy-Coach/) · [G2: CoachRx vs Hevy Coach vs Everfit](https://www.g2.com/compare/coachrx-vs-hevy-coach-vs-everfit)

**Comparisons:** [FitBudd: Everfit vs Trainerize vs TrueCoach](https://www.fitbudd.com/insights/everfit-vs-trainerize-vs-truecoach) · [Capterra: PT Distinction](https://capterra.com/p/141155/PT-Distinction/) · [G2: Everfit vs My PT Hub vs Trainerize](https://www.g2.com/compare/everfit-vs-my-pt-hub-vs-abc-trainerize) · [FitBudd: PT Distinction review](https://fitbudd.com/grow/reviewing-pt-distinction-is-it-worth-it-for-personal-trainers)
