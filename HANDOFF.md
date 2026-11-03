# Repsy: handoff

Repsy (the code still calls itself **Kinetic** in package names, the UI and docs) is a coaching web app for personal
trainers: coaches build programs and run their clients from one place; clients train, log and check in from a
mobile-first portal. This file is the starting point for whoever picks the project up next.

Status on 3 November 2026: releases **R1, R2 and R3 are complete**, and **R4 has not been started** on purpose. The
R3 completion work (payments, scheduling, journeys, AI drafting, custom domains, access after a lapse) is on the
branch `claude/charming-allen-mnzedx`; everything before it is on `main`, with the full history from the first
commit.

## 1. Run it locally

Prerequisites: Node 24 (`nvm use`), pnpm (`corepack enable`), Docker.

```sh
pnpm install
pnpm db:up                 # Postgres 16 on localhost:54320
cp .env.example .env       # works as-is with no provider keys
# edit .env: set SEED_PASSWORD to any local value of 12+ characters
pnpm db:migrate            # applies all 91 migrations
pnpm db:seed               # demo users; prints a pilot sign-up code once
pnpm dev                   # web on http://localhost:3000 + the background worker
```

Sign in as `coach@example.test` (or `admin@example.test`) with your `SEED_PASSWORD`. With provider keys blank, emails
are written to `.dev-emails/` (also listed at `/api/dev/emails`), Google sign-in is hidden, push, Sentry and
PostHog are off, and uploads go to local disk. `README.md` has the long version and a paragraph per feature.

## 2. How it is built

| Part               | What it is                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`         | Next.js 16 App Router (`cacheComponents`), React, Tailwind. Coach app under `/app`, client portal under `/portal`, public pages (`/join/<slug>`, invites, calendar feed), REST API under `/api/v1`.                                    |
| `apps/worker`      | pg-boss worker: email and push outbox, reminders, check-in issuing, automations, scheduled messages, phase advances, exports, deletions, media purge, weekly brief, billing and renewal sweep, calendar sync, custom-domain checks.    |
| `packages/core`    | All domain logic. Functions take `(tx, actor, ...)` and throw `DomainError`; no provider SDKs (providers sit behind ports with fakes; the SDK-based adapters live in the apps). Pure modules are exported on subpaths for browser use. |
| `packages/db`      | Prisma 7 schema, 91 SQL migrations, tenant helpers. Postgres row-level security is forced on every tenant table.                                                                                                                       |
| `packages/storage` | Storage port (local disk in dev, object storage in production).                                                                                                                                                                        |
| `docs/`            | `decisions.md` (all rulings), `competitive/complete-platform-prd.md` (the feature list), `architecture/overview.md`, `api/openapi.yaml`, `runbook.md`, `qa-matrix.md`, `accessibility-checklist.md`, `legal/`.                         |
| `render.yaml`      | Render blueprint: Postgres, the web service and the worker.                                                                                                                                                                            |

Rules every change follows (more in `docs/decisions.md` and the architecture overview):

- **Tenancy:** every request runs in `withTenant`; RLS isolates workspaces. Any request-path `withSystem` must be
  listed in the `packages/db/src/tenant.ts` inventory and in `WITH_SYSTEM_ALLOWED` (`apps/web/test/platform-admin.test.ts`).
- **New tenant tables** get the `tenant_isolation` policy, an entry in both lists in `packages/db/src/rls.test.ts`,
  and erasure in `packages/core/src/privacy/deletion.ts`.
- **Migrations:** write `packages/db/prisma/migrations/2026010100NNNN_name/migration.sql`, mirror it in
  `schema.prisma`, run `pnpm db:generate`, then `pnpm db:diff` against a shadow database must say "No difference
  detected".
- **Roles:** owner, admin, coach, assistant (staff) and client; permissions live in the `POLICY` table in
  `packages/core/src/authz/policies.ts`.
- **Accessibility:** WCAG 2.2 AA. Every page in the E2E suite is checked with axe at 375 px and 1440 px.

## 3. Checks

```sh
pnpm typecheck
pnpm lint                  # 4 known warnings, 0 errors
pnpm format:check
DATABASE_URL=postgres://... pnpm test        # 187 unit and integration test files, 1054+ tests, all passing
pnpm test:e2e                                # 92 Playwright specs
```

The unit suite creates a throwaway database per file from `DATABASE_URL`. The last full run passed; every feature
built since was checked with its own unit tests and end-to-end spec.

## 4. What is built

The feature IDs refer to `docs/competitive/complete-platform-prd.md`; each one has a line in `README.md` and, where
a choice had to be made, a numbered ruling in `docs/decisions.md` (D-011 for R2, D-012 and D-013 for R3).

**R1 and R2 (complete):** workspaces, sign-up with pilot codes, two-factor sign-in, roles and branding; clients,
invites, tags, bulk actions, intake and onboarding; the program builder (blocks, supersets, set targets, 104-week
programs, version history, fast edits, templates, import, calendar); assignment and scheduling; the client portal
with workout logging, extra workouts, swaps, rest timers, offline start and crash recovery (installable PWA); review
queue and rules; messages with attachments and anchored replies; check-ins and the form library; body metrics,
photos, compare, records, exercise history, goals, progress page; habits, tasks, resources, nutrition targets and
logs; analytics and adherence; web push; exports, deletion and the privacy features; platform admin and support.

**R3 (built):**

- A10-A14: team roles and invites, my-clients scope and transfers, cover while away, owner audit log
- B14-B16, B20: agreements to sign, public page with applications, lead pipeline, lifecycle stages
- C12, C17, C20: progression rules, program phases, house templates
- D18: plate helper
- E5: assessment photos with guide lines and scheduled retests
- E8: training load trends
- E10: monthly branded PDF progress report
- F11: conditional check-in questions
- G4: lessons and courses dripped daily or weekly
- G8, G9: meal plans (days x meals with swaps, or a PDF) and recipes, with a shopping list
- G13: nutrition review rule
- H5: scheduled messages
- H7, H8: groups with a chat and a feed, reactions, reports, mutes and coach moderation
- H9: challenges with an opt-in leaderboard
- I4: engagement signal; I7: business analytics (cohorts, lifetime, churn reasons) and "End coaching"
- I9: weekly coach brief
- J1-J3, J5, J7-J9: automations (triggers, steps, ask-first, failures, history, templates)
- L7: calendar feed
- K1-K9, K15 (D-013): Stripe Connect and Razorpay behind one payments port (with a fake), packages (one-off,
  recurring, payment plans, trials), storefront checkout on the public page, coupons, gap-free receipts with GST,
  failed payments with a portal gate after the grace period, `/portal/billing` self-service, revenue on business
  analytics with CSV, manual cash and bank payments
- K10, K11, H15: session types, weekly hours and time off, client booking in the portal and coach booking, never
  double-booked, session packs with credits, reminders, the calendar feed, Google and Outlook two-way sync, https
  call links
- J4, J6: sequences started by a purchase, an upcoming renewal or end, or a package ending; renewal notices
- I10-I12, I14: AI drafting (owner opt-in, trainers only, 50 a day): pasted text or a template to a draft in the
  import review, and check-in highlights linked to their answers; names, contact details and medical lines kept out
- L4: custom domains for the public page and storefront, and branded sending
- M12: read-only access after a lapse, 90 days for clients and 180 for staff

## 5. What is left

**R3 is complete.** What only the founder can do (provider accounts, keys, the hosting side of custom domains) and
the known limits are in `docs/r3-followups.md`.

**R4 (not started, by decision):** A15, A16, D19, E12, E13, G10, G11, H12, I13, J10, K12, K13, K14, L2, L3, L5, L6,
L8, L9, L10, M11, M14, M15.

## 6. Things to know

- **The name:** the product is Repsy here; the code, UI copy, emails and docs still say Kinetic. Renaming is a
  search-and-replace plus the package scope `@kinetic/*`.
- **PDF reports** use a small built-in writer (`packages/core/src/reports/pdf.ts`) with the standard Helvetica font:
  Western European text renders; other scripts show as "?" until a font is embedded. Only JPEG photos are drawn.
- **Group activity** sends no notifications; the chat refreshes every 20 seconds while open.
- **Workspace files** (exercise demos, recipe photos, meal-plan PDFs) can be fetched by any member of the workspace;
  client files (progress and assessment photos, attachments, form checks) only by that client and their coaches.
- **Video** plays as uploaded; adaptive streaming waits for a media provider (D-011 #5).
- **Production needs:** `BETTER_AUTH_SECRET`, `RESEND_API_KEY` and `EMAIL_FROM`, object storage, and optionally
  Google sign-in, VAPID keys for push, Sentry and PostHog; for R3's providers, `PROVIDER_TOKEN_KEY` plus each
  provider's keys (`docs/r3-followups.md`). All variables are documented in `.env.example`.
- **Fakes:** development and E2E take payments, sync a calendar and draft with AI through deterministic fakes
  (`FAKE_PAYMENTS`, `FAKE_CALENDAR`, `FAKE_AI` set to `on`; never in production). The test checkout is at
  `/dev/checkout/<ref>`.
- **Dev servers:** every server page and layout sets `export const instant = false` (Next 16's opt-out from
  instant-navigation validation, as its cache-components guide recommends for apps that read the session per
  request), so the dev overlay doesn't flag them. Remove it from a segment once that segment streams its session
  read behind `<Suspense>` or caches it. `next build` passes either way.
