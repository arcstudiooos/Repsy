import type { Metadata } from 'next';
import Link from 'next/link';
import { CHURN_LABEL, getBusinessAnalytics } from '@repsy/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Business analytics | Repsy' };

const monthLabel = (m: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );
const days = (d: number | null) =>
  d === null ? '–' : d >= 60 ? `${Math.round(d / 30.4)} months` : `${d} days`;

/** PRD I7: retention cohorts, client lifetime and why coaching ended. Every chart has the table it draws. */
export default async function BusinessAnalyticsPage() {
  const a = await withServerTenant((tx, actor) => getBusinessAnalytics(tx, actor));
  const peak = Math.max(1, ...a.monthly.flatMap((m) => [m.started, m.ended]));
  return (
    <>
      <Link
        href="/app/analytics"
        className="mb-4 inline-block text-accent underline underline-offset-4"
      >
        Back to analytics
      </Link>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Business analytics</h1>
      <div className="flex flex-col gap-6">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Clients now', String(a.activeNow)],
            ['Started, last 90 days', String(a.startedLast90)],
            ['Ended, last 90 days', String(a.endedLast90)],
            ['Typical time coached (median)', days(a.medianLifetimeDays)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-card bg-surface p-4 shadow-card">
              <dt className="text-sm text-secondary">{k}</dt>
              <dd className="text-3xl font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-secondary">
          Average time coached: {days(a.averageLifetimeDays)}. A client starts when they accept
          their invite and ends when you end coaching. Revenue and payments are on{' '}
          <Link href="/app/billing" className="text-accent underline underline-offset-4">
            Billing
          </Link>
          .
        </p>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Started and ended, by month</CardTitle>
            <CardDescription>The last 12 months</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div aria-hidden className="flex h-32 items-end gap-1">
              {a.monthly.map((m) => (
                <div key={m.month} className="flex h-full flex-1 items-end gap-0.5">
                  <div
                    className="flex-1 bg-accent"
                    style={{ height: `${(m.started / peak) * 100}%` }}
                  />
                  <div
                    className="flex-1 bg-secondary"
                    style={{ height: `${(m.ended / peak) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <p aria-hidden className="text-sm text-secondary">
              <span className="mr-1 inline-block size-3 bg-accent" /> Started{' '}
              <span className="mr-1 ml-3 inline-block size-3 bg-secondary" /> Ended
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Clients started and ended per month</caption>
                <thead>
                  <tr className="text-secondary">
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Month
                    </th>
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Started
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Ended
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {a.monthly.map((m) => (
                    <tr key={m.month} className="border-t border-divider">
                      <th scope="row" className="py-1 pr-4 font-normal">
                        {monthLabel(m.month)}
                      </th>
                      <td className="py-1 pr-4">{m.started}</td>
                      <td className="py-1">{m.ended}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Retention by starting month</CardTitle>
            <CardDescription>Share still coached 1, 3 and 6 months after starting</CardDescription>
          </CardHeader>
          <CardContent>
            {a.cohorts.length === 0 ? (
              <p className="text-secondary">No one has started in the last 12 months.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Retention cohorts</caption>
                  <thead>
                    <tr className="text-secondary">
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Started
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        Clients
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        After 1 month
                      </th>
                      <th scope="col" className="py-1 pr-4 font-medium">
                        After 3 months
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        After 6 months
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.cohorts.map((c) => (
                      <tr key={c.month} className="border-t border-divider">
                        <th scope="row" className="py-1 pr-4 font-normal">
                          {monthLabel(c.month)}
                        </th>
                        <td className="py-1 pr-4">{c.started}</td>
                        {c.retained.map((r) => (
                          <td key={r.after} className="py-1 pr-4">
                            {r.percent === null ? (
                              <span className="text-secondary">not yet</span>
                            ) : (
                              `${r.percent}%`
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Why coaching ended</CardTitle>
            <CardDescription>
              The last 12 months, from the reason chosen when ending coaching
            </CardDescription>
          </CardHeader>
          <CardContent>
            {a.churnReasons.length === 0 ? (
              <p className="text-secondary">No one has left in the last 12 months.</p>
            ) : (
              <ul aria-label="Reasons" className="flex flex-col gap-2">
                {a.churnReasons.map((r) => (
                  <li
                    key={r.reason}
                    className="flex justify-between gap-4 border-b border-divider py-1"
                  >
                    <span>
                      {r.reason === 'unknown' ? 'No reason given' : CHURN_LABEL[r.reason]}
                    </span>
                    <span>{r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
