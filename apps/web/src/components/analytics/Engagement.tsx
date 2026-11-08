import type { EngagementWeek } from '@repsy/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const week = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
const pct = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 100)}%`);

/** PRD I4: the weekly engagement score, newest first, with what it is made of. Never labelled "at risk". */
export function EngagementCard({ weeks }: { weeks: EngagementWeek[] }) {
  const scored = weeks.filter((w) => w.score !== null);
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
          <div
            role="region"
            aria-labelledby="engagement-caption"
            tabIndex={0}
            className="overflow-x-auto"
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
        )}
      </CardContent>
    </Card>
  );
}
