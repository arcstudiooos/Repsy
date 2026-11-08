# UI/UX redesign plan

Status: **Approved** (2026-11-04). All open questions answered (section 8). Nothing is implemented yet.

Goal: a modern, premium and consistent web app where data is shown visually (cards, tiles, rings, charts, heatmaps) instead of text lists.

---

## 1. What exists today (audit)

Sources: `apps/web/src`, `docs/screenshots/*`, `docs/decisions.md`, `docs/accessibility-checklist.md`.

**Good foundations to keep**

- Next.js 16 + Tailwind 4 + Radix + CVA. Tokens live in `src/styles/tokens.css` and `src/lib/tokens.ts` (kept in sync by `tokens.test.ts`).
- Few hard-coded colours (only `text-white`/`bg-white`). Accessibility is taken seriously: 44px targets, reduced motion, axe in every e2e spec.

**Problems**

| #   | Area             | Problem                                                                                                                                                                                                                                    |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Colour           | One muted teal (`#1C7666`) on off-white. No palette for status, charts or highlights. Reads as "admin tool", not premium. No dark mode.                                                                                                    |
| P2  | Data             | Every metric is plain text: "0 skipped / 0 not finished / 0 missed", "0 of 1 workout done". Analytics page is explicitly "counts only, no charts" (D-008 #1).                                                                              |
| P3  | Hierarchy        | Dashboard = six identical white boxes with a label and a big number. No trend, no delta, no context, no priority.                                                                                                                          |
| P4  | Links as actions | Primary actions are underlined text links ("Open the review queue", "See all workouts", "All workouts", rule filters on Review). Inconsistent with the button system.                                                                      |
| P5  | Components       | Only 7 UI primitives (button, card, dialog, input, skeleton, tabs, toast). Badges, stat tiles, page headers, filter chips, avatars, selects and tables are re-built per page with slightly different styles. Native `<select>` on Clients. |
| P6  | Client detail    | Overview is a key/value form dump (email, time zone, units). No picture of how the client is doing: adherence, streak, strength progress, wellbeing.                                                                                       |
| P7  | Workout logger   | Each set is a tall fieldset with empty space; no previous-performance hint, no progress through the workout, actions not sticky on mobile.                                                                                                 |
| P8  | Shell            | Sidebar has no brand mark, no badge counts (review, unread), sign-out block collides with the avatar. Portal top nav is plain. Mobile coach dashboard is one long column of tiles.                                                         |
| P9  | Empty states     | Plain sentences ("Nothing needs review right now.") with no icon, illustration or next step.                                                                                                                                               |
| P10 | Naming           | The UI and metadata used an old working name instead of **Repsy** (fixed).                                                                                                                                                                 |

---

## 2. Visual direction

**"Midnight & Ember"** (chosen 2026-11-04): midnight navigation and hero tiles, warm off-white content surfaces, ember orange as the brand colour and cyan for progress and wins. Light and dark themes both supported. (The rejected option was "Graphite & Volt": violet + lime.)

### 2.1 Colour tokens

**Palette 19, "Periwinkle & Acid"** (D-018, 2026-11-05). This replaces the earlier "Midnight & Ember" palette. The exact values live in `apps/web/src/styles/tokens.css` and `src/lib/tokens.ts`, and `tokens.test.ts` asserts every text pair below in both themes.

Light

| Token                                                 | Hex                                           | Use                                                                                                         | Required contrast                                  |
| ----------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `canvas` / `surface` / `surface-2` / `sidebar`        | `#F5F5FF` / `#FFFFFF` / `#EEEEFB` / `#EEEEFC` | Background, cards, insets, sidebar                                                                          | —                                                  |
| `ink` / `ink-muted`                                   | `#12131F` / `#4A5160`                         | Text                                                                                                        | ≥ 4.5 on canvas, surface, surface-2, sidebar       |
| `border` / `input-border`                             | `#E2E2F2` / `#8A8CA6`                         | Decorative / control borders                                                                                | input ≥ 3                                          |
| `brand` / `brand-hover` / `brand-pressed`             | `#5B5BD6` / `#4A4AC4` / `#3D3DAE`             | Primary buttons (white text), links, active nav, focus ring                                                 | ≥ 4.5 vs white and sidebar                         |
| `brand-soft` / `brand-ink`                            | `#E4E4FB` / `#3D3DAE`                         | Selected rows, chips, ring track / text on it                                                               | ≥ 4.5                                              |
| `acid` / `acid-soft` / `on-acid` / `acid-ink`         | `#E8FF47` / `#F7FFC2` / `#12131F` / `#5C6B00` | Highlights: today, PRs, wins. **Never text, never a lone shape on white**, always with an `on-acid` outline | on-acid ≥ 4.5 on acid; acid-ink ≥ 4.5 on acid-soft |
| `success` / `warning` / `danger` / `info` (+ `-soft`) | `#0B7A45` / `#9A5B00` / `#C0283C` / `#0A7C8C` | Status                                                                                                      | ≥ 4.5 on white and on soft                         |

Dark: canvas `#0E0F1A`, surface `#171828`, surface-2 `#1F2135`, sidebar `#131425`, ink `#F1F1FA` / `#A3A6C2`, borders `#2A2C44` / `#6B6E8C`, brand `#8E8EF5`, with the primary button `#8E8EF5` and `#0E0F1A` text. brand-soft is `#272A52`, and acid is `#E8FF47`, which may be text on dark surfaces. Status colours are `#4ADE80` / `#FBBF24` / `#F87171` / `#22D3EE`, with soft tints at 15 % over the surface.

Charts, categorical and in this order: `#5B5BD6` periwinkle · `#0E8FA3` teal · `#D6407A` raspberry · `#C27C00` amber · `#2E9E5B` green · `#6B6F86` slate (lighter equivalents in dark). Every one is ≥ 3:1 on the surface. Acid is a highlight only, never a series on light surfaces.

Older token names (`accent*`, `ember`, `cyan*`, `midnight*`, `secondary`) stay as aliases of this palette. `midnight` is now the brand hero surface: the auth brand panel and the portal next-workout card.

**Logo deviation:** the brief asked for a periwinkle square with an acid "R". The founder supplied their own gradient "R" (D-017), and that is kept as the mark.

### 2.2 Type, shape, depth, motion

- Font: keep **Geist** (already loaded), add tabular numerals (`font-variant-numeric: tabular-nums`) for every metric.
- Type scale: `display 36/40`, `h1 28/34`, `h2 20/28`, `h3 16/24`, `body 15/22`, `caption 13/18`, `micro 11/14 uppercase tracking-wide` for tile labels.
- Radius: `sm 8` (controls), `md 12` (chips, inputs), `lg 16` (cards), `xl 24` (hero cards), `full` (pills, avatars).
- Elevation: 3 levels only. `e0` border only, `e1` resting card (soft, low-opacity shadow), `e2` popovers/dialogs. Cards use a 1px `border` + `e1` instead of shadow alone.
- Motion: keep 120/180ms tokens; add number count-up and chart draw-in (both disabled by `prefers-reduced-motion`).

---

## 3. Design system (consistency layer)

New or rebuilt primitives in `src/components/ui/`, all token-driven and CVA-based. Every page uses these; no one-off styling.

| Component                                                    | Purpose                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                                 | Title, subtitle, breadcrumb, right-side actions. One per page.                                                            |
| `Section`                                                    | Titled group with optional action link-button.                                                                            |
| `Card` (variants: `default`, `inset`, `hero`, `interactive`) | Replaces ad-hoc `cardClass` strings.                                                                                      |
| `StatTile`                                                   | Label, big value, delta vs previous period (▲/▼ + text), optional sparkline, optional href.                               |
| `Badge` (status variants)                                    | Replaces `StatusBadge`, `SessionStateBadge` and rule labels with one component: icon + text + semantic colour.            |
| `Avatar` / `AvatarStack`                                     | Initials with deterministic colour from the chart palette.                                                                |
| `Progress` (bar) and `ProgressRing`                          | Weekly progress, adherence, completion.                                                                                   |
| `Segmented`                                                  | Date range presets, view toggles (list/grid), Review state filter.                                                        |
| `FilterChip`                                                 | Review rules, client status (with counts). Replaces underlined text filters.                                              |
| `Select`, `DropdownMenu`, `Tooltip`, `Popover`               | Radix-based; replace native `<select>`.                                                                                   |
| `DataTable`                                                  | Sticky header, row hover, sortable columns, mobile collapse to cards.                                                     |
| `EmptyState` (rebuilt)                                       | Icon in a soft circle, title, one sentence, primary action.                                                               |
| `Skeleton` patterns                                          | Tile, chart, table-row and list skeletons that match the final layout.                                                    |
| `Button`                                                     | Add `link` and `soft` variants; every action that is currently an underlined link becomes a button or a `Section` action. |

Charts in `src/components/charts/`:

- **Server-rendered SVG** (no JS, fast, works offline in the portal): `Sparkline`, `ProgressRing`, `Donut`, `StackedBar`, `WeekDots`, `ConsistencyHeatmap`.
- **Interactive (client)**: `LineChart`, `BarChart`, `AreaChart` with tooltips, built on **Recharts 3** (React 19 compatible), wrapped so pages never import Recharts directly and colours come only from tokens.
- Every chart ships with: a visible title, legend or direct labels, a `<figcaption>`/`aria-label` summary sentence, and a "View as table" toggle (keeps the numerator/denominator transparency D-008 #1 asked for).

A `/app/dev/ui` page (dev only) renders every component in light and dark for review and screenshot tests.

---

## 4. Page-by-page plan

### 4.1 Shell and navigation

- **Coach sidebar**: graphite background, Repsy logo mark, nav items with brand-soft active pill and left indicator, **badge counts** on Review and Messages, collapsible to icons on `lg`. Bottom: user card (avatar, name, org) with a menu for Settings, workspace switch, theme toggle and sign out.
- **Coach mobile**: bottom tab bar with active pill and badges; page content uses 2-column tile grids instead of one long column.
- **Portal**: compact top bar with logo and avatar on desktop; bottom tab bar on mobile with a raised centre "Train" button.
- **Command palette (⌘K)** for coaches: jump to a client, program or page.

### 4.2 Coach dashboard (`/app`)

1. **Greeting header**: "Good morning, Casey" + date + quick actions (Add client, New program).
2. **KPI row** (4 `StatTile`s): Adherence this week (% + 8-week sparkline + delta), Workouts completed (count + delta), Check-in response rate, Open review items.
3. **This week chart**: stacked bar per day (completed / skipped / missed / due), today highlighted.
4. **Needs attention**: list of up to 5 flags as compact cards with avatar, rule badge, age, and inline actions (Message, Snooze, Resolve).
5. **Client pulse** grid: every active client as a small tile with avatar, 7-day `WeekDots`, adherence ring; sorted by "needs attention first".
6. **Recent activity** feed: completed workouts, PRs, submitted check-ins, messages (icon timeline).

### 4.3 Analytics (`/app/analytics`)

- `Segmented` range: This week · 4 weeks · 12 weeks · Custom (date inputs in a popover).
- **Adherence**: donut (completed / skipped / not finished / missed) with centre % + 12-week trend line.
- **Assigned vs finished**: grouped bars per week.
- **Check-in response rate**: ring + weekly trend.
- **Due check-ins** and **median time to follow-up**: stat tiles with deltas; follow-up time also as a small histogram.
- **Per-client table**: client, adherence bar, workouts, check-in rate, sortable, row click → client.
- Every chart keeps the numerator, denominator and period visible (tooltip + table view).

### 4.4 Clients (`/app/clients`)

- Header with count, search, status `FilterChip`s with counts (Active 12 · Invited 3 · Paused 1 · Archived), list/grid `Segmented` toggle.
- **List view** `DataTable`: avatar + name + email, status badge, program name, 4-week adherence bar, last workout (relative), next workout, unread dot.
- **Grid view**: client cards with adherence ring, `WeekDots`, current program, quick actions.

### 4.5 Client detail (`/app/clients/[id]`)

- **Hero header**: avatar, name, status badge, program + week "Week 3 of 8" progress bar, actions (Message, Pause, more menu holding Request deletion).
- **Overview tab** becomes a dashboard:
  - Stat tiles: 4-week adherence, current streak, workouts completed, last check-in.
  - **Consistency heatmap**: last 12 weeks, one cell per scheduled day, coloured by state with legend.
  - **Strength progress**: exercise picker + line chart of top-set weight and estimated 1RM (Epley) over time, PR markers.
  - **Training volume**: weekly volume bars (sets × reps × kg).
  - **Wellbeing trend**: energy / sleep / stress / satisfaction (1–5) lines from check-ins.
  - Profile details collapsed into a compact "About" card (email, time zone, units, joined, goals).
- **Sessions**: month calendar or week strip with state colours + list below.
- **Check-ins**: answers shown side by side with the previous week, 1–5 answers as mini bars with a trend sparkline per question.
- **History**: vertical timeline with icons per event type and day grouping.
- **Program**: week × day grid overview before the exercise detail.

### 4.6 Review (`/app/review`)

- State `Segmented` with counts (Needs attention 4 · Snoozed 1 · Closed).
- Rule `FilterChip`s with counts and icons instead of underlined links.
- Flag cards with a left severity accent, avatar, rule badge, "raised 2d ago", inline actions.
- Activity sections become collapsible lists with counts in the header.

### 4.7 Messages

- Two-pane inbox: avatars, last message preview, unread badge, relative time.
- Chat bubbles (own = brand, other = surface-2), day separators, sent/read ticks, sticky composer.

### 4.8 Programs

- Program cards: name, weeks × days, exercise count, clients-using `AvatarStack`, last edited.
- Editor: sticky week tabs, day columns as cards, exercise cards with drag handle and compact set table, sticky save bar with status pill.

### 4.9 Client portal

- **Home**: hero "Next workout" card (graphite with volt accent) with exercises preview and big Start button; weekly `ProgressRing` + `WeekDots`; streak tile; "Check-in due" card when relevant; recent PRs.
- **Workouts**: week strip at top, Upcoming as cards, History with per-workout volume and duration.
- **Workout logger**:
  - Sticky header with workout name, elapsed time, sync pill, and overall progress bar (sets done / planned).
  - Compact set table per exercise: `Set | Previous | kg | Reps | RPE | ✓` with large inputs (44px), previous performance pre-filled as placeholder.
  - Collapsible "How to do it".
  - Sticky bottom bar on mobile: Complete / Skip.
  - Finish dialog shows a summary: duration, total volume, sets, PRs (tiles).
- **Check-ins**: 1–5 questions as large segmented pills; progress indicator across questions.
- **Profile**: "My progress" with the same strength, volume and consistency charts the coach sees (client-safe data only).

### 4.10 Settings, auth, onboarding, admin

- Settings: left section nav (desktop) / grouped list (mobile), each section a card with clear save state.
- Auth (login, signup, reset, verify, invite): split layout, brand panel (graphite + volt gradient, product visual) and form card.
- Admin: same `DataTable`, `Badge` and `StatTile` components.

---

## 5. Data and backend work needed for charts

Charts need series, not just counts. New read-only functions in `packages/core` (tenant-scoped like existing queries), used by server components:

| Function                                    | Returns                                                     | Used by                                     |
| ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| `getAdherenceSeries(range, bucket)`         | per week: completed, skipped, notFinished, missed, eligible | Dashboard, Analytics                        |
| `getDailySessionStates(weekStart)`          | per day: counts by state                                    | Dashboard "This week"                       |
| `getClientAdherence(range)`                 | per client: adherence ratio, last/next workout              | Clients list, Client pulse, Analytics table |
| `getClientConsistency(clientId, weeks)`     | per scheduled day: state                                    | Heatmap                                     |
| `getExerciseProgress(clientId, exerciseId)` | per session: top set, e1RM, volume, PR flag                 | Client overview, Portal profile             |
| `getWeeklyVolume(clientId, weeks)`          | per week: volume                                            | Client overview, Portal                     |
| `getCheckinSeries(clientId, questionIds)`   | per check-in: 1–5 answers                                   | Client check-ins, overview                  |
| `getStreak(clientId)`                       | consecutive completed scheduled sessions                    | Tiles                                       |

Each comes with unit tests in `packages/core` and a perf check in `pnpm perf:dashboard`.

---

## 6. Constraints and decisions to respect

- **D-008 #1 says analytics are "counts only, no charts".** This plan reverses that. Add a new decision record (D-0xx) in `docs/decisions.md` first (step 1 of section 7). Charts keep numerator, denominator and period visible to honour the original intent.
- Wellbeing answers are never sent to PostHog (D-008 builder call). Charts are in-app only; no new analytics events carry answer values.
- WCAG 2.2 AA stays: tokens re-validated in `tokens.test.ts`, axe specs must pass at 375/768/1440, 44px targets, status never by colour alone, reduced motion respected, every chart has a text alternative.
- Offline portal: server-rendered SVG charts only on offline-cached portal pages; no chart JS needed to log a workout.
- E2E specs select by role and text. Keep accessible names and copy stable, or update specs in the same change.
- Regenerate `docs/screenshots/` at the end.

---

## 7. Build order (one go)

No phases: everything is built in one continuous pass, on one branch, shipped as one PR. Steps run in this order because each one depends on the one before.

1. Decision record replacing D-008 #1 in `docs/decisions.md`.
2. Tokens (light + dark), type scale, `tokens.test.ts` update, ThemeProvider.
3. Use the name "Repsy" everywhere a user sees it, plus the logo mark.
4. Component library + chart primitives + `/app/dev/ui` page.
5. Core series queries in `packages/core` (section 5) with unit tests.
6. Shell and navigation (coach sidebar, mobile tab bars, portal bar).
7. Coach dashboard and analytics.
8. Clients list and client detail (all tabs).
9. Review and messages.
10. Portal home, workouts, logger, check-ins, profile.
11. Programs, settings, auth, onboarding, admin, command palette.
12. Final check: typecheck, lint, unit tests, e2e + axe at 375/768/1440 in light and dark, manual a11y pass, perf check, screenshot refresh (before/after in the PR).

---

## 8. Decisions (all answered)

1. ~~Palette~~: **decided, Midnight & Ember** (2026-11-04).
2. ~~Product name~~: **decided, Repsy** (2026-11-04). Scope: every user-facing string (page titles, metadata, nav logo, emails sent by the worker, export file names, e2e/axe specs that assert the name), about 64 occurrences in 49 files under `apps/` and `packages/`. Internal package names (`@repsy/*`), env vars and DB identifiers stay as they are to avoid churn. Done right after the tokens (step 3 of section 7).
3. ~~Dark mode~~: **decided, ship it with everything else** (2026-11-04). Default follows the system setting; a Light / Dark / System toggle lives in the user menu (coach) and Profile (portal), saved per user on the device. Theme is applied before first paint (no flash). Every chart, badge and status colour gets a dark value; axe specs and screenshots run in both themes.
4. ~~Reverse D-008 #1~~: **approved** (2026-11-04). Step 1 of the build order writes the new decision record in `docs/decisions.md` (charts allowed in analytics, dashboard, client and portal views; every chart keeps numerator, denominator and period visible and has a table view) and marks D-008 #1 as superseded by it.
5. ~~Chart library~~: **decided, Recharts 3** (2026-11-04) for interactive charts (line, bar, area with tooltips), pinned to an exact version and wrapped in `src/components/charts/` so pages never import it directly. Small charts (sparkline, ring, donut, week dots, heatmap) stay server-rendered SVG, so offline portal pages need no chart JS.
6. ~~Portal progress charts~~: **decided, in scope now** (2026-11-04). Portal Profile gets "My progress" (strength, volume, consistency) built in step 10, using the same series queries as the coach view, limited to the client's own data. Wellbeing answers are shown to the client in-app only and never sent to analytics.

- **2026-11-05:** the palette changed to palette 19, "Periwinkle & Acid" (§2.1, D-018), from the founder's UI brief. Sidebar, shell and component details follow that brief.
