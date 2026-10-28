# Implementation Plan — Kinetic MVP (R1)

> Status: Proposed specification derived from `Kinetic_Coaching_Platform_Agent_Ready_PRD.docx`
> Working name "Kinetic" is provisional per §6.2. No AI-first identity (§1.5).

---

## 0. Document purpose & operating constraints

This plan translates the PRD into a concrete dependency graph, sprint breakdown, and ticket hierarchy referencing **Fxx** functional requirement IDs and **QAxx** test areas from the PRD's QA matrix (§16).

### Hard rules (from §1.2, §15.2)
- **No AI features** in R1 — no AI workout generation, AI check-in chat, or automated diagnosis.
- **Quiet utility, not an AI persona** (§1.5).
- Every feature requires: schema migration, API validation, automated tests, UI states.
- **Tenant isolation** — every query scoped to `organization_id`; never trust client-supplied org ID (§7.2).
- **Idempotency keys** on all submissions (§7.2).
- **Optimistic updates** with rollback and visible error feedback (§7.2).
- Feature flags for under-tested rollout (§7.2).
- Synthetic data only — never real customer data in seed/dev (§15.2).
- Deploy secrets never committed; `.env.example` with placeholders only (§15.2).

---

## 1. Dependency graph (vertical slices)

```
Sprint 0: Foundations
├── package.json (monorepo via npm workspaces + Turbo)
├── TypeScript config + ESLint + Prettier
├── Design tokens package (@kinetic/design-tokens)
├── Database schema + Prisma migrations
├── Auth service skeleton (Auth.js adapter pattern)
├── CI pipeline (GitHub Actions)
└── Seed script (synthetic data)
│
Sprint 1: Clients
├── Organization schema (orgs, memberships)
├── Client CRUD API (F03, F04)
├── Client invitation flow (F04)
├── Client portal auth (invite accept)
├── UI: Client directory, profile, settings
└── QA: auth/tenant, exports/privacy

Sprint 2: Programming
├── Exercise library (F05, F06)
├── Program builder with autosave (F06)
├── Program version history (F06)
├── Program assignment (F07)
├── UI: Program builder, week/day navigator
└── QA: builder, training, tenant isolation

Sprint 3: Client Experience
├── Workout logging API (F08)
├── Check-in templates + submission (F09)
├── Client portal: workout screen, check-in screen
├── UI state: offline draft, save status
└── QA: training, check-ins, network failure

Sprint 4: Review + Messaging
├── Review rules engine (F10, §10)
├── Review queue UI
├── Messaging threads (F11)
├── Coach→client messages
└── QA: review timezone, messaging pagination

Sprint 5: Analytics + Hardening
├── Analytics API (F13)
├── CSV export (F13, F01)
├── E2E Playwright tests
├── Accessibility audit
├── Observability (Sentry, structured logs)
├── Performance tuning
└── QA: scale, UI responsiveness

Sprint 6: Pilot Iteration
├── Synthetic demo data deployment
├── Time-on-task benchmarking
├── Pricing probe support
├── Pilot launch checklist
└── Go/no-go decision
```

---

## 2. Sprint breakdown

### Sprint 0 — Foundations (P0 infrastructure)
| Ticket | F-ID | Description |
|--------|------|-------------|
| S0-01 | — | Monorepo setup: npm workspaces + Turbo, shared TS config, ESLint, Prettier |
| S0-02 | — | `@kinetic/design-tokens` package: color tokens (§6.2), spacing, typography, shadows |
| S0-03 | F01 | Prisma schema with all entities from §8, initial migrations |
| S0-04 | F01 | Auth.js integration with organization guards, session management |
| S0-05 | — | CI: GitHub Actions (lint, typecheck, test, build) |
| S0-06 | — | Seed script with synthetic data (5 orgs, 20 clients each, demo programs) |
| S0-07 | — | `.env.example` with all required placeholders |
| S0-08 | — | README with architecture diagram and local dev instructions |

**Definition of done**: Preview deploy available, unit tests pass, auth flow works.

### Sprint 1 — Clients (P0 user lifecycle)
| Ticket | F-ID | QA | Description |
|--------|------|----|-------------|
| S1-01 | F01, F03 | QA: auth/tenant | Org + membership schema + API: create org, invite coach |
| S1-02 | F03 | QA: auth/tenant | Client directory: search, filter (active/invited/paused/archived) |
| S1-03 | F04 | QA: auth/tenant | Client invitation: expiring token, claim flow, privacy notice |
| S1-04 | F03 | QA: exports/privacy | Client profile: timezone, goals, constraints, status, notes |
| S1-05 | F14 | — | Settings page: org identity, units, notifications, export/delete request |
| S1-06 | F14 | QA: exports/privacy | Data export request + deletion request workflow |
| S1-07 | — | QA: auth/tenant | Tenant isolation tests: cross-org ID access blocked |

**Definition of done**: Coach can invite clients, clients can onboard, no data leaks between orgs.

### Sprint 2 — Programming (P0 builder)
| Ticket | F-ID | QA | Description |
|--------|------|----|-------------|
| S2-01 | F05 | — | Exercise library: seed generic exercises, search/filter, add custom |
| S2-02 | F06 | QA: builder | Program builder: weeks/days → workouts → exercises → sets |
| S2-03 | F06 | QA: builder | Autosave + version history + conflict resolution (F06) |
| S2-04 | F06, F07 | QA: builder | Program assignment: start date, recurring days, timezone |
| S2-05 | F06 | QA: training | Last logged performance shown alongside editor |
| S2-06 | — | QA: builder | Undo/redo, empty program handling, rapid edit resilience |

**Definition of done**: Coach can build, version, and assign programs; autosave survives refresh.

### Sprint 3 — Client Experience (P0 logging)
| Ticket | F-ID | QA | Description |
|--------|------|----|-------------|
| S3-01 | F08 | QA: training | Workout logging API (idempotent, 24h edit window) |
| S3-02 | F07, F08 | QA: training | Scheduled sessions in client timezone, grace period |
| S3-03 | F09 | QA: check-ins | Check-in templates: wellbeing, energy, satisfaction, barriers |
| S3-04 | F09 | QA: check-ins | Check-in submission: autosaved draft, optional fields |
| S3-05 | F08 | QA: training | Mobile-first workout screen: large tap targets, save status |
| S3-06 | — | QA: network failure | Offline draft persistence, retry with backoff |

**Definition of done**: Client can log workouts and check-ins on mobile; no data loss on disconnect.

### Sprint 4 — Review + Messaging (P0 workflow)
| Ticket | F-ID | QA | Description |
|--------|------|----|-------------|
| S4-01 | F10, §10 | QA: review | Review rules engine: missed workouts, overdue check-in, new check-in, unread message |
| S4-02 | F10 | QA: review | Review queue UI: filter, snooze, resolve with reason |
| S4-03 | F11 | QA: messaging | Message threads (1:1), attachments (safe types, size caps) |
| S4-04 | F11 | QA: messaging | Email notifications for new messages (opt-in) |
| S4-05 | F12 | — | History timeline: activity, logs, check-ins, notes |
| S4-06 | F14 | — | Dashboard: needs-attention list with explainable flags |

**Definition of done**: Full closed-loop E2E — client logs workout → review queue updates → coach messages.

### Sprint 5 — Analytics + Hardening (P0→P1)
| Ticket | F-ID | QA | Description |
|--------|------|----|-------------|
| S5-01 | F13 | QA: analytics | Analytics API: assigned/finished workouts, response rate, follow-up time |
| S5-02 | F13 | QA: exports/privacy | CSV export for client data, workout history |
| S5-03 | — | QA: E2E | Playwright tests for all 5 journeys (§5) |
| S5-04 | — | QA: accessibility | WCAG 2.2 AA audit for core journeys |
| S5-05 | — | QA: UI | Responsive: 375px/768px/1440px viewports |
| S5-06 | — | QA: scale | 50-client dashboard load, queue processing |
| S5-07 | — | QA: scale | Sentry + structured logs + request tracing |

**Definition of done**: Pilot launch checklist passed — backups tested, monitoring live, accessibility baseline.

### Sprint 6 — Pilot Iteration (P0 validation)
| Ticket | F-ID | QA | Description |
|--------|------|----|-------------|
| S6-01 | — | — | Deploy synthetic demo environment |
| S6-02 | — | — | 20 coach recruitment, 10 with time-on-task comparison |
| S6-03 | F14, §14 | — | $29–$49 pricing probe |
| S6-04 | — | — | Weekly review time measurement (target: ≥30% faster) |
| S6-05 | — | — | Go/no-go decision with evidence |

**Definition of done**: Paid pilot decision with ≥3 paid coaches, or clear no-go data.

---

## 3. Technology stack (from §7)

| Layer | Choice |
|-------|--------|
| Monorepo | npm workspaces + Turbo |
| Frontend | Next.js 15 App Router + React 19 + TypeScript |
| UI | Tailwind CSS + shadcn/ui + Radix Primitives |
| Forms | React Hook Form + Zod |
| Server API | Next.js route handlers + service layer |
| Database | PostgreSQL (local Docker, Supabase for deploy) |
| ORM | Prisma |
| Auth | Auth.js with organization guards |
| Storage | S3-compatible (MinIO for local) |
| Queue | BullMQ (Redis) for background jobs |
| Email | Resend (transactional) |
| Analytics | PostHog (privacy configured) |
| Monitoring | Sentry + structured logs |
| Testing | Vitest (unit), React Testing Library, Playwright (E2E) |
| CI/CD | GitHub Actions + Vercel |

---

## 4. Architecture overview

```
┌─────────────────────────────────────────────┐
│  Browser/PWA                                 │
├─────────────────────────────────────────────┤
│  Next.js UI (App Router)                     │
│  ┌────────────────┬──────────────────────┐  │
│  │ Coach Workspace │ Client Portal        │  │
│  └────────────────┴──────────────────────┘  │
├─────────────────────────────────────────────┤
│  Authenticated API (Route Handlers)           │
│  Service Layer (no provider SDK calls)       │
│  ┌─────────┬─────────┬────────┬───────────┐ │
│  │Identity │Clients  │Programs│Review     │ │
│  │         │Logs     │Builder │Messaging  │ │
│  └─────────┴─────────┴────────┴───────────┘ │
├─────────────────────────────────────────────┤
│  PostgreSQL + Object Storage                  │
│  (Redis for queue)                           │
└─────────────────────────────────────────────┘
```

### External service adapters
All third-party providers (email, storage, analytics) must be behind adapter interfaces — never imported directly into business logic (§7.2).

---

## 5. Risk register

| Risk | Mitigation | Owned by |
|------|-----------|----------|
| Tenant data leak | Server-side org scoping, tenant isolation tests | Backend |
| Data loss on save | Idempotency keys, durable writes, retry with backoff | Backend |
| Review false alerts | Deterministic rules with explainable evidence, <10% target | Backend |
| Mobile usability | Touch targets ≥44px, keyboard nav, reduced motion | Frontend |
| Pricing misalignment | $29–$49 pilot probe, competitive audit | Product |

---

## 6. Success metrics baseline (from §2.1)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Coach activation | ≥40% create client + assign + receive log | Funnel tracking |
| Weekly review time | ≥30% faster vs. baseline | Time-on-task study |
| Dashboard p75 load | <2.5s, 50 clients | Synthetic monitoring |
| False alerts | <10% | Review queue audit |
| Paid pilots | ≥3 of 20 contacted | CRM tracking |
