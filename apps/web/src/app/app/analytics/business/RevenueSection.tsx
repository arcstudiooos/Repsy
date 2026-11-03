import type { RevenueSummary } from '@kinetic/core';
import { formatMoney } from '@kinetic/core/money';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const monthLabel = (m: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

/** PRD K9 (D-013 #9): recurring revenue, churn, refunds and client value, with the table the chart draws. */
export function RevenueSection({ r }: { r: RevenueSummary }) {
  if (!r.currency) return null;
  const money = (n: number | null) => (n === null ? '–' : formatMoney(n, r.currency!));
  const peak = Math.max(1, ...r.monthly.map((m) => m.netMinor));
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Revenue</CardTitle>
        <CardDescription>
          In {r.currency}. Manual payments count; voided ones don&apos;t.{' '}
          <a href="/api/v1/billing/revenue?format=csv" className="text-accent underline">
            Download CSV
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Monthly recurring revenue', money(r.mrrMinor)],
            ['Active subscriptions', String(r.activeSubscriptions)],
            ['Subscription churn, 30 days', r.churnPercent === null ? '–' : `${r.churnPercent}%`],
            ['Refunded, 30 days', money(r.refundedLast30Minor)],
            ['Average client value, 12 months', money(r.averageClientValueMinor)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-card bg-canvas p-3">
              <dt className="text-sm text-secondary">{k}</dt>
              <dd className="text-2xl font-semibold break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <div aria-hidden className="flex h-24 items-end gap-1">
          {r.monthly.map((m) => (
            <div
              key={m.month}
              className="flex-1 bg-accent"
              style={{ height: `${(Math.max(0, m.netMinor) / peak) * 100}%` }}
            />
          ))}
        </div>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Revenue by month">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <caption className="sr-only">Net revenue per month</caption>
            <thead>
              <tr className="text-secondary">
                <th scope="col" className="py-1 pr-4 font-medium">
                  Month
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Payments
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Gross
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Refunded
                </th>
                <th scope="col" className="py-1 font-medium">
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {r.monthly.map((m) => (
                <tr key={m.month} className="border-t border-divider">
                  <th scope="row" className="py-1 pr-4 font-normal">
                    {monthLabel(m.month)}
                  </th>
                  <td className="py-1 pr-4">{m.payments}</td>
                  <td className="py-1 pr-4">{money(m.grossMinor)}</td>
                  <td className="py-1 pr-4">{money(m.refundedMinor)}</td>
                  <td className="py-1">{money(m.netMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
