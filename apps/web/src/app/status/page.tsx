import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { readNotices, RELIABILITY_TARGETS } from '@kinetic/core';

export const metadata: Metadata = { title: 'Service status | Repsy' };

const LABEL = { maintenance: 'Maintenance', degraded: 'Degraded', outage: 'Outage' } as const;
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso)) + ' UTC';

/** PRD M8, M9: current status, incident history with post-mortems, and the reliability targets. Public. */
export default function StatusPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-4 text-3xl font-semibold">Service status</h1>
      <Suspense fallback={<p className="text-secondary">Loading status…</p>}>
        <StatusBody />
      </Suspense>
    </main>
  );
}

async function StatusBody() {
  // Read at request time: the status is live, never prerendered at build.
  await connection();
  const { open, recent } = await readNotices();
  return (
    <>
      <p
        role="status"
        className={`mb-8 rounded-card bg-surface p-4 text-lg font-medium shadow-card ring-1 ${open.length ? 'ring-warning' : 'ring-accent'}`}
      >
        {open.length === 0
          ? 'All systems normal.'
          : open.map((n) => `${LABEL[n.severity]}: ${n.message}`).join(' · ')}
      </p>
      <h2 className="mb-3 text-xl font-semibold">Reliability targets</h2>
      <dl className="mb-8 grid gap-2 sm:grid-cols-3">
        {RELIABILITY_TARGETS.map((t) => (
          <div key={t.label} className="rounded-card bg-surface p-4 shadow-card">
            <dt className="text-sm text-secondary">{t.label}</dt>
            <dd className="font-semibold">{t.target}</dd>
          </div>
        ))}
      </dl>
      <h2 className="mb-3 text-xl font-semibold">Recent incidents</h2>
      {recent.length === 0 ? (
        <p className="text-secondary">No incidents reported.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {recent.map((n) => (
            <li key={n.id} className="rounded-card bg-surface p-4 shadow-card">
              <p className="font-medium">
                {LABEL[n.severity]} · {fmt(n.createdAt)}
                {n.resolvedAt ? ` · resolved ${fmt(n.resolvedAt)}` : ' · ongoing'}
              </p>
              <p>{n.message}</p>
              {n.postmortem && (
                <details className="mt-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-accent">
                    Post-mortem
                  </summary>
                  <p className="whitespace-pre-line text-secondary">{n.postmortem}</p>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
