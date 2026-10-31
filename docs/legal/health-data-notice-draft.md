# Health-related data notice — DRAFT for counsel

> **Status:** engineering draft (S5-5, D-007). Not legal advice; not published. Counsel to confirm whether any processed data counts as health or special-category data in each pilot jurisdiction, and what consent or notice that requires.

## What could be considered health-related

- Weekly check-in answers on **energy, sleep, stress** and free-text answers ("What got in the way this week?").
- Workout performance (weights, reps, effort) and comments, and messages, if a client writes about how they feel.

## What Kinetic does not do

- No injury, medical-history or medical-clearance fields, and no health advice or AI-generated guidance (D-007).
- Check-in answers and messages never go to analytics, logs or audit records.

## Safeguards in place

- Data is scoped to one coaching workspace (database row-level security); other clients and other workspaces can't see it.
- Coaches see a client's check-in answers only after the client sends them (drafts stay private).
- Readiness is confirmed by the coach before a first program is assigned; the portal shows a safety reminder until the first workout.
- Export and deletion are self-serve; support access is explicit, time-limited and audited.

## Questions for counsel

1. Do wellbeing ratings (energy, sleep, stress) require explicit consent in the pilot jurisdictions?
2. Is the current consent at invite acceptance (privacy notice version recorded per client) sufficient, or is a separate health-data consent needed?
3. Wording for the in-app notice shown before the first check-in, if required.
