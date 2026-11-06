import type { Metadata } from 'next';
import Link from 'next/link';
import { TRIAL_CLIENT_LIMIT, TRIAL_DAYS } from '@kinetic/core';

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
        Pricing is shared with pilot workspaces before general availability. Questions?{' '}
        <Link href="/support" className="text-accent underline">
          Contact support
        </Link>
        .
      </p>
    </main>
  );
}
