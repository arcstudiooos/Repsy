import type { Metadata } from 'next';
import { TRIAL_CLIENT_LIMIT, TRIAL_DAYS } from '@repsy/core';
import { PLAN_CONTACT, PLANS, planMailto } from '@/content/marketing';

export const metadata: Metadata = {
  title: 'Plan and fair-billing charter | Repsy',
  description:
    "Repsy's billing promises: one price with every feature, one-click cancel, pro-rated refunds and a 7-day renewal notice.",
  alternates: { canonical: '/plan' },
};

const CHARTER = [
  ['One price, everything included', 'No add-ons, no feature tiers, no per-client surprises.'],
  ['Cancel in one click', 'From Settings, any time. Your data stays exportable afterwards.'],
  ['Pro-rated refunds', 'Downgrade or cancel mid-period and the unused time is refunded.'],
  [
    'No surprise renewals',
    'Annual plans get an email 7 days before they renew, with a link to cancel.',
  ],
  ['Your data is yours', 'Export everything as CSV and JSON whenever you like, on any plan.'],
] as const;

/** PRD M10, A4: the fair-billing charter and the free trial. Public. */
export default function PlanPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-2 text-3xl font-semibold">Plan and fair-billing charter</h1>
      <p className="mb-8 text-secondary">
        Start with a free {TRIAL_DAYS}-day trial for up to {TRIAL_CLIENT_LIMIT} clients, no card
        needed. Pilot workspaces keep their pilot access.
      </p>
      <h2 className="mb-3 text-xl font-semibold">Paid plans</h2>
      <ul className="mb-4 flex flex-col gap-3">
        {PLANS.filter((p) => p.monthly > 0).map((p) => (
          <li key={p.id} className="rounded-card bg-surface p-4 shadow-card">
            <p className="font-medium">
              {p.name}: ${p.monthly} a month, or ${p.annual} a year
            </p>
            <p className="text-secondary">
              Up to {p.clients} active clients and {p.seats} coach{' '}
              {p.seats === 1 ? 'seat' : 'seats'}, every feature included.{' '}
              <a href={planMailto(p.name)} className="text-accent underline">
                Email us for {p.name}
              </a>
            </p>
          </li>
        ))}
      </ul>
      <p className="mb-8 text-secondary">
        Online checkout is coming soon. Until then, email{' '}
        <a href={`mailto:${PLAN_CONTACT}`} className="text-accent underline">
          {PLAN_CONTACT}
        </a>{' '}
        and we move your workspace to the plan you choose, and cancel it the same way. The promises
        below apply to every paid plan.
      </p>
      <h2 className="mb-3 text-xl font-semibold">Our promises</h2>
      <ul className="mb-8 flex flex-col gap-3">
        {CHARTER.map(([title, body]) => (
          <li key={title} className="rounded-card bg-surface p-4 shadow-card">
            <p className="font-medium">{title}</p>
            <p className="text-secondary">{body}</p>
          </li>
        ))}
      </ul>
      <p className="text-secondary">
        Questions?{' '}
        <a href={`mailto:${PLAN_CONTACT}`} className="text-accent underline">
          Email {PLAN_CONTACT}
        </a>
        .
      </p>
    </main>
  );
}
