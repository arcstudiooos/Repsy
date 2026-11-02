# Repsy R3 Implementation Plan — the remaining features

**Goal:** Finish R3 of `docs/competitive/complete-platform-prd.md`: coaches take payments (packages, storefront and checkout, coupons, receipts and tax, failed payments, billing self-service, revenue, manual payments), clients book sessions that can use credit packs and carry a call link, purchases start onboarding and renewal journeys, coaches can opt in to AI drafting, a workspace can use its own domain, and a lapsed workspace keeps read-only access and export.

**PRD refs:** K1-K11, K15, H15, J4, J6, I10-I12, I14, L4, M12.

**Spec:** the PRD rows above as amended by `docs/decisions.md` (D-001 onwards). Every call made while building is recorded in **D-013** (R3 completion rulings). Where they conflict, decisions.md wins.

**Definition of done (per task):** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, the task's E2E specs green, `next build` green for UI tasks, `db:diff` clean for migrations, a security-focused review approved. New tenant tables follow `HANDOFF.md` §2 (RLS policy, both `rls.test.ts` lists, erasure in `privacy/deletion.ts`, exports where they hold client data).

## Rulings made while planning

Recorded in full as D-013 in `docs/decisions.md`. In short:

1. **No provider accounts exist yet.** Payments, calendar sync, AI and branded sending each go behind a `packages/core` port. A deterministic **fake adapter** runs in development and tests. The real adapters (Stripe Connect, Razorpay, Google and Microsoft calendars, Anthropic, Resend domains) call the providers' REST APIs with `fetch` (no SDKs, D-005 adapters rule) and are enabled only when their environment variables are set. They are unit-tested against recorded request and webhook shapes, never against live accounts.
2. **Money** is integer minor units with one ISO currency per workspace. Every provider event is stored once (unique provider event id) and applied idempotently.
3. **Purchases never skip safety rules.** A purchase creates (or links) the client and sends the invite. A package's template is not assigned silently: once the client is active, a "Ready to assign" review item asks the coach to confirm readiness (D-007 #6), then assigns.
4. **Failed payments** never touch sessions or pauses (D-003). After the workspace's grace period the portal shows a payment gate, like agreements (D-012 #5), until the payment succeeds or the coach lifts it.
5. **AI drafting** (I14) is off by default per workspace, coach-side only, on explicit request, always a labelled draft, never a client name, contact detail or medical, injury or supplement advice (a post-filter removes such lines and says so), with a daily cap and content-free audit.
6. **Custom domains** serve the public page and storefront; sign-in and the portal stay on the main domain in R3, so auth cookies, CSRF origins and OAuth callbacks are unchanged.
7. **Lapse** (M12): a workspace lapses when a platform admin marks it lapsed (paid pilots are invoiced outside the app, D-008 #12) or its trial ends. Members then get read-only access and export: clients for 90 days, staff for 180 days.

## Task order

| Task | PRD                | Contents                                                                                                                                                                                                               |
| ---- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3.1 | K3, K15            | `PaymentsPort` + fake adapter; `payment_accounts`, `packages`, `purchases`, `payments`, `payment_events`; package editor; manual payments; receipts numbering; erasure and exports                                     |
| R3.2 | K1, K2, K4, K5, K6 | Stripe Connect (OAuth, Checkout, webhooks) and Razorpay (OAuth, orders and subscriptions, webhooks) adapters; storefront and checkout on `/join/<slug>`; coupons; branded receipts with tax lines (Stripe Tax, GST)    |
| R3.3 | K7, K8, K9         | Failed payments (review item, client email, grace and payment gate); `/portal/billing` (plan, next charge, receipts, update card, one-click cancel); revenue on `/app/analytics/business` with CSV                     |
| R3.4 | K10, K11, H15      | Session types, availability and time off, bookings (coach and client, time-zone-safe, buffers, notice, no double booking), reminders, ICS for bookings, `CalendarSyncPort` (Google, Outlook), credit packs, call links |
| R3.5 | J4, J6             | `package_purchased` / `package_renewal_due` / `package_ended` events and triggers; renewal sweep with client reminder and coach follow-up                                                                              |
| R3.6 | I10-I12, I14       | `AiPort` + fake and Anthropic adapters; workspace opt-in; paste to program (into the C14 import review); draft from a template (a builder draft); check-in highlights with source links; guardrails                    |
| R3.7 | L4                 | `custom_domains` with DNS TXT verification (worker), host routing for the public page and storefront; branded sending addresses through the email adapter (Resend domains)                                             |
| R3.8 | M12                | Workspace lapse state (platform admin, trial end), read-only enforcement in `apiHandler` and the worker, export kept, windows of 90 and 180 days, banners                                                              |
| R3.9 | —                  | Whole-branch review, full checks, README, HANDOFF, OpenAPI, `.env.example`, follow-ups                                                                                                                                 |

## Out of scope (R4 by the PRD)

Selling programs and courses to self-guided buyers (K13), referrals (K14), group classes (K12), built-in video (H15 R4), AI reply drafts (I13), native apps.
