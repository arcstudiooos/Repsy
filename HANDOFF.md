# Repsy: handoff

Repsy (the code still calls itself **Kinetic** in package names, the UI and docs) is a coaching web app for personal
trainers: coaches build programs and run their clients from one place; clients train, log and check in from a
mobile-first portal. This file is the starting point for whoever picks the project up next.

Status on 2 November 2026: releases **R1 and R2 are complete**, **R3 is mostly built** (see the list below), and
**R4 has not been started** on purpose. Everything below is on `main` in this repository, with the full history
from the first commit.

> **Update, 6 November 2026 (branch `feat/roadmap-cuts-and-builds`):** the R3 branch has merged. This branch removes
> AI drafting (I10–I12, I14), custom domains (L4) and the cut R4 items (D-019), and builds the I15 AI assistant, real
> Google Calendar sync (K10), adaptive video (L11), locations (A15), single sign-on (A16), group classes (K12), update
> safety (M11) and the security programme (M14). K13 and K14 are on hold. See `README.md`, R4 features.

## 1. Run it locally

Prerequisites: Node 24 (`nvm use`), pnpm (`corepack enable`), Docker.

```sh
pnpm install
pnpm db:up                 # Postgres 16 on localhost:54320
cp .env.example .env       # works as-is with no provider keys
# edit .env: set SEED_PASSWORD to any local value of 12+ characters
pnpm db:migrate            # applies all 85 migrations
pnpm db:seed               # demo users; prints a pilot sign-up code once
pnpm dev                   # web on http://localhost:3000 + the background worker
```

Sign in as `coach@example.test` (or `admin@example.test`) with your `SEED_PASSWORD`. With provider keys blank, emails
are written to `.dev-emails/` (also listed at `/api/dev/emails`), Google sign-in is hidden, push, Sentry and
PostHog are off, and uploads go to local disk. `README.md` has the long version and a paragraph per feature.

## 2. How it is built

| Part               | What it is                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`         | Next.js 16 App Router (`cacheComponents`), React, Tailwind. Coach app under `/app`, client portal under `/portal`, public pages (`/join/<slug>`, invites, calendar feed), REST API under `/api/v1`.            |
| `apps/worker`      | pg-boss worker: email and push outbox, reminders, check-in issuing, automations, scheduled messages, phase advances, exports, deletions, media purge, weekly brief.                                            |
| `packages/core`    | All domain logic. Functions take `(tx, actor, ...)` and throw `DomainError`; no provider SDKs. Pure modules are exported on subpaths for browser use.                                                          |
| `packages/db`      | Prisma 7 schema, 85 SQL migrations, tenant helpers. Postgres row-level security is forced on every tenant table.                                                                                               |
| `packages/storage` | Storage port (local disk in dev, object storage in production).                                                                                                                                                |
| `docs/`            | `decisions.md` (all rulings), `competitive/complete-platform-prd.md` (the feature list), `architecture/overview.md`, `api/openapi.yaml`, `runbook.md`, `qa-matrix.md`, `accessibility-checklist.md`, `legal/`. |
| `render.yaml`      | Render blueprint: Postgres, the web service and the worker.                                                                                                                                                    |

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
pnpm test:e2e                                # 90 Playwright specs
```

The unit suite creates a throwaway database per file from `DATABASE_URL`. The last full run passed; every feature
built since was checked with its own unit tests and end-to-end spec.

## 4. What is built

The feature IDs refer to `docs/competitive/complete-platform-prd.md`; each one has a line in `README.md` and, where
a choice had to be made, a numbered ruling in `docs/decisions.md` (D-011 for R2, D-012 for R3).

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

## 5. What is left

**R3:** built and merged. Payments run on fake providers until real Stripe/Razorpay keys and webhooks are added;
M12 lapses are recorded by a platform admin until the coach's own plan billing exists.

**R4:** A15, A16, K12, L11, M11 and M14 are built (see `README.md`). K13 and K14 are on hold. M15 is not started.
Everything else in R4 was removed from scope (D-019).

## 6. Things to know

- **The name:** the product is Repsy here; the code, UI copy, emails and docs still say Kinetic. Renaming is a
  search-and-replace plus the package scope `@kinetic/*`.
- **PDF reports** use a small built-in writer (`packages/core/src/reports/pdf.ts`) with the standard Helvetica font:
  Western European text renders; other scripts show as "?" until a font is embedded. Only JPEG photos are drawn.
- **Group activity** sends no notifications; the chat refreshes every 20 seconds while open.
- **Workspace files** (exercise demos, recipe photos, meal-plan PDFs) can be fetched by any member of the workspace;
  client files (progress and assessment photos, attachments, form checks) only by that client and their coaches.
- **Video:** coach demo videos stream adaptively through Cloudflare Stream when it is configured (L11); otherwise
  they play as uploaded. Client videos (form checks) are never sent to Stream.
- **Production needs:** `BETTER_AUTH_SECRET`, `RESEND_API_KEY` and `EMAIL_FROM`, object storage, and optionally
  Google sign-in and Calendar sync, Microsoft SSO, `ANTHROPIC_API_KEY` for the AI assistant, Cloudflare Stream, VAPID
  keys for push, Sentry and PostHog. All variables are documented in `.env.example`.
- **Dev servers** log "uncached data during prerendering" warnings on dynamic pages; they are expected and
  `next build` passes.

## 7. Where to look first

1. `README.md`: setup and one paragraph per feature.
2. `docs/decisions.md`: why things are the way they are (D-001 onwards).
3. `docs/competitive/complete-platform-prd.md`: the full feature list with release tags.
4. `docs/architecture/overview.md` and `docs/runbook.md`: the system and how to operate it.
