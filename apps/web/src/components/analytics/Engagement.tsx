import type { EngagementWeek } from '@kinetic/core';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Columns } from '@/components/charts/Columns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const week = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
const pct = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 100)}%`);

/** PRD I4: the weekly engagement score, newest first, with what it is made of. Never labelled "at risk". */
export function EngagementCard({ weeks }: { weeks: EngagementWeek[] }) {
  const scored = weeks.filter((w) => w.score !== null);
  const latest = scored[scored.length - 1];
  const prev = scored[scored.length - 2];
  const delta = latest && prev ? latest.score! - prev.score! : null;
  const lastIdx = weeks.length - 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Engagement</CardTitle>
        <CardDescription>
          A weekly score from 0 to 100: workouts done, check-ins sent, messaging you, and days they
          opened the app. Parts with nothing due that week are left out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {scored.length === 0 ? (
          <p className="text-secondary">The score starts once the client has a full week.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <p className="text-sm text-secondary">Latest score</p>
                <p className="tabular text-4xl font-bold tracking-tight">
                  {latest!.score}
                  <span className="text-lg font-medium text-secondary">/100</span>
                </p>
              </div>
              {delta !== null && (
                <p
                  className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium ${
                    delta >= 0
                      ? 'bg-success-soft text-success-ink'
                      : 'bg-danger-soft text-danger-ink'
                  }`}
                >
                  {delta >= 0 ? (
                    <TrendingUp aria-hidden className="size-4" />
                  ) : (
                    <TrendingDown aria-hidden className="size-4" />
                  )}
                  {delta >= 0 ? '+' : ''}
                  {delta} vs the week before
                </p>
              )}
            </div>
            <Columns
              max={100}
              summary={`Engagement score by week: ${weeks
                .map((w) => `${week(w.weekStart)} ${w.score ?? 'not scored'}`)
                .join(', ')}.`}
              data={weeks.map((w, i) => ({
                label: week(w.weekStart),
                value: w.score,
                current: i === lastIdx,
              }))}
            />
            <details className="group rounded-control border border-divider">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium text-accent-ink">
                Weekly breakdown
              </summary>
              <div
                role="region"
                aria-labelledby="engagement-caption"
                tabIndex={0}
                className="overflow-x-auto px-3 pb-2"
              >
                <table className="w-full text-base">
                  <caption id="engagement-caption" className="sr-only">
                    Engagement by week
                  </caption>
                  <thead>
                    <tr className="border-b border-divider text-left text-sm text-secondary">
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Week of
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Score
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Workouts
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Check-ins
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        Messaged
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        App days
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...weeks].reverse().map((w, i) => (
                      <tr key={w.weekStart} className="border-b border-divider last:border-0">
                        <th scope="row" className="py-2 pr-3 text-left font-normal">
                          {week(w.weekStart)}
                          {i === 0 && <span className="text-sm text-secondary"> (so far)</span>}
                        </th>
                        <td className="py-2 pr-3 font-semibold tabular-nums">{w.score ?? '–'}</td>
                        <td className="py-2 pr-3 tabular-nums">{pct(w.parts.workouts)}</td>
                        <td className="py-2 pr-3 tabular-nums">{pct(w.parts.checkins)}</td>
                        <td className="py-2 pr-3">{w.parts.messages ? 'Yes' : 'No'}</td>
                        <td className="py-2 tabular-nums">{pct(w.parts.visits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
