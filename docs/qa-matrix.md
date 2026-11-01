# QA matrix (S5-5)

Every pilot-critical behavior and where it is tested. **Unit/integration** tests run with `pnpm test` (Vitest, real Postgres); **E2E** with `pnpm test:e2e` (Playwright, axe on touched screens). The PRD §16 case list is not in this repository; this matrix covers the implementation plan's Review Focus items, every journey, and each sprint's acceptance tests.

## Review Focus

| #   | Risk                                        | Tests                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | DST and time-zone boundaries                | `packages/core/src/schedule/scheduleSlots.test.ts` (DST gap/fold), `clients/pause.test.ts` ("DST-crossing shift keeps 23:59 local"), `review/rules.test.ts` ("due 23:59 Pacific/Auckland … missed at that UTC instant"), `checkins/checkins.test.ts` (06:00 NY after DST end), `apps/worker/src/jobs/checkinsIssue.test.ts` (London vs New York) |
| 2   | Replay and duplicate submission             | `apps/web/test/session-logging.int.test.ts`, `apps/web/src/portal/offline/outbox.test.ts`, `e2e/offline.spec.ts` (one row per set, one completion), `checkins.test.ts` (submit ×2), `messages.test.ts` (clientMessageId), `exports.test.ts` (idempotent request), `analytics-events.int.test.ts` (no double events)                              |
| 3   | Dual-role users and guessed ids             | `apps/web/test/cross-tenant.int.test.ts`, every `*.int.test.ts` 404 cross-org case, `packages/db/src/rls.test.ts`, `tenantIntegrity.test.ts`, `privacy/deletion.test.ts` (dual-role deletion keeps org A)                                                                                                                                        |
| 4   | Coach edits while the client is mid-workout | `assignments/reconcile.test.ts`, `programs/commit.test.ts`, `e2e/offline.spec.ts` ("coach commit while offline")                                                                                                                                                                                                                                 |
| 5   | Unit round-trip (lb ↔ kg)                   | `packages/core/src/units.test.ts`, `apps/web/test/session-logging.int.test.ts`                                                                                                                                                                                                                                                                   |

## Journeys

| Journey                                                                     | E2E spec                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Golden path (sign-up → invite → program → assign → log → complete → review) | `e2e/golden-path.spec.ts`                                                     |
| A: coach onboarding and first client                                        | `e2e/sprint1-journey.spec.ts`, `e2e/invite.spec.ts`, `e2e/clients.spec.ts`    |
| B: editing a client program safely                                          | `e2e/journey-b.spec.ts`, `e2e/programs.spec.ts`                               |
| C: client logs a workout (online and offline)                               | `e2e/workout-logging.spec.ts`, `e2e/offline.spec.ts`, `e2e/log-edits.spec.ts` |
| D: review queue                                                             | `e2e/journey-d.spec.ts`, `e2e/review.spec.ts`                                 |
| E: export and deletion                                                      | `e2e/exports.spec.ts`, `e2e/journey-e.spec.ts`                                |
| Closed loop (Sprint 4 DoD)                                                  | `e2e/closed-loop.spec.ts`                                                     |

## Features

| Area                                             | Unit / integration                                                                   | E2E                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Auth, pilot codes, verification, password rules  | `auth.int.test.ts`, `signup-gate.int.test.ts`, `auth-env.test.ts`                    | `auth.spec.ts`                                     |
| Tenancy, RLS, runtime role                       | `rls.test.ts`, `tenant.test.ts`, `appRole.test.ts`, `assertRuntimeRole.test.ts`      | `workspace-switch.spec.ts`                         |
| Clients, invites, active-client limit            | `clients.test.ts`, `invites.int.test.ts`                                             | `clients.spec.ts`, `invite.spec.ts`                |
| Pause and resume                                 | `pause.test.ts`, `pausesEnd.test.ts`, `pause.int.test.ts`                            | `pause.spec.ts`                                    |
| Programs, drafts, versions, conflicts            | `commit.test.ts`, `drafts.test.ts`, `versions.test.ts`, `program-drafts.int.test.ts` | `programs.spec.ts`, `journey-b.spec.ts`            |
| Scheduling and assignment                        | `scheduleSlots.test.ts`, `assign.test.ts`, `assign.int.test.ts`                      | `golden-path.spec.ts`                              |
| Workout logging, coach logging                   | `lifecycle.test.ts`, `upsertSetLogs` tests, `session-logging.int.test.ts`            | `workout-logging.spec.ts`, `coach-logging.spec.ts` |
| Log edits and corrections                        | `revise.test.ts`, `log-revisions.int.test.ts`                                        | `log-edits.spec.ts`                                |
| Offline outbox and service worker                | `outbox.test.ts`, `workoutCache.test.ts`                                             | `offline.spec.ts` (production build)               |
| Check-ins                                        | `checkins.test.ts`, `checkinsIssue.test.ts`, `checkins.int.test.ts`                  | `checkins.spec.ts`                                 |
| Messages (body never logged, email without body) | `messages.test.ts`, `messages.int.test.ts`                                           | `messages.spec.ts`                                 |
| Missed/incomplete and review rules               | `rules.test.ts`, `reviewSweep.test.ts`                                               | `journey-d.spec.ts`                                |
| Review queue actions                             | `flags.test.ts`, `review-flags.int.test.ts`                                          | `journey-d.spec.ts`                                |
| Notes and history (never in client payloads)     | `history.test.ts`, `notes.int.test.ts`                                               | `closed-loop.spec.ts`                              |
| Analytics counts                                 | `adherence.test.ts`                                                                  | `analytics.spec.ts`                                |
| Product events (allowlist, no PII)               | `ports/analytics.test.ts`, `analytics-events.int.test.ts`                            | —                                                  |
| Exports                                          | `exports.test.ts`, `exportsBuild.test.ts`, `exports.int.test.ts`, `storage.test.ts`  | `exports.spec.ts`                                  |
| Deletion and admin console                       | `deletion.test.ts`, `privacy.int.test.ts`                                            | `journey-e.spec.ts`                                |
| Settings and preferences                         | `settings.test.ts`, `settings.int.test.ts`                                           | `settings.spec.ts`                                 |

## Non-functional

| Check                                           | How                                                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessibility (WCAG 2.2 AA)                     | axe in every UI spec at 375/1440 (and 768 where listed); manual checklist in `docs/accessibility-checklist.md`                                                                                  |
| No horizontal overflow at 375/768/1440          | `expectNoHorizontalOverflow` in the UI specs                                                                                                                                                    |
| Dashboard performance (50 clients, p75 < 2.5 s) | `pnpm perf:dashboard` (see `docs/runbook.md`)                                                                                                                                                   |
| Dependency audit                                | `pnpm audit --prod` (clean on 2026-10-30)                                                                                                                                                       |
| Rate limits                                     | `api-envelope.int.test.ts` (429 envelope, Retry-After), `invite-accept.int.test.ts` and `signup-gate.int.test.ts` (attempt limits); per-route `rateLimit` on logs, drafts, messages and invites |
| API contract                                    | `docs/api/openapi.yaml`, envelope tests in `api-envelope.int.test.ts`                                                                                                                           |
| Screenshots of main routes at 375/1440          | `e2e/screenshots.spec.ts` → `docs/screenshots/`                                                                                                                                                 |
