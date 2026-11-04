import type { HabitsView } from '@kinetic/core';
import { habitHeatmap, HEATMAP_WEEKS } from '@kinetic/core/habit-heatmap';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmt = (d: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );

/**
 * PRD G2: 12 weeks × 7 days of habits met, as a table (its own text alternative): each day shows habits met of those
 * active, shaded by share. Below it, each habit's completion over the 12 weeks.
 */
export function HabitHeatMap({ view }: { view: HabitsView }) {
  if (view.habits.length === 0) return null;
  const map = habitHeatmap(view.habits, view.todayLocalDate);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Last {HEATMAP_WEEKS} weeks</CardTitle>
        <CardDescription>
          Each day shows habits met out of habits active that day. Darker means more were met.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          role="region"
          aria-labelledby="habit-heatmap-caption"
          tabIndex={0}
          className="overflow-x-auto"
        >
          <table className="border-separate border-spacing-1 text-center text-sm">
            <caption id="habit-heatmap-caption" className="sr-only">
              Habits met per day, last {HEATMAP_WEEKS} weeks
            </caption>
            <thead>
              <tr>
                <th scope="col" className="pr-2 text-left font-medium text-secondary">
                  Week of
                </th>
                {DAYS.map((d) => (
                  <th key={d} scope="col" className="font-medium text-secondary">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {map.weeks.map((w) => (
                <tr key={w.monday}>
                  <th
                    scope="row"
                    className="pr-2 text-left font-normal whitespace-nowrap text-secondary"
                  >
                    {fmt(w.monday)}
                  </th>
                  {w.days.map((d) => {
                    const share = d.active ? d.done / d.active : 0;
                    return (
                      <td
                        key={d.date}
                        className={cn(
                          'h-9 min-w-9 rounded-control',
                          d.future || d.active === 0
                            ? 'bg-canvas text-secondary'
                            : share === 1
                              ? 'bg-accent-fill font-semibold text-on-accent'
                              : share >= 0.5
                                ? 'bg-accent/35 text-ink'
                                : share > 0
                                  ? 'bg-accent/15 text-ink'
                                  : 'bg-canvas text-ink',
                        )}
                      >
                        {d.future ? '' : d.active === 0 ? '–' : `${d.done}/${d.active}`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul aria-label="Completion per habit" className="flex flex-col gap-1">
          {map.habits.map((h) => (
            <li key={h.id} className="flex flex-wrap justify-between gap-2">
              <span className="break-words">{h.title}</span>
              <span className="text-secondary">
                {h.percent === null
                  ? 'Nothing due yet'
                  : `${h.percent}% (${h.done} of ${h.expected} days)`}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
