import type { TrainingLoad as Load } from '@kinetic/core';
import { toDisplay, type Units } from '@kinetic/core/units';

const week = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
const th = 'px-3 py-2 text-left text-sm font-medium text-secondary';
const td = 'px-3 py-2 tabular-nums';

/**
 * PRD E8: the last 8 weeks of completed training (sessions, sets, volume, average RPE) and sets per muscle group.
 * Plain tables, readable on a phone (they scroll inside their own region).
 */
export function TrainingLoad({ load, units }: { load: Load; units: Units }) {
  const trained = load.weeks.some((w) => w.sets > 0);
  const recent = load.weeks.slice(-4);
  return (
    <section aria-labelledby="load-heading" className="flex flex-col gap-4">
      <h2 id="load-heading" className="text-lg font-semibold">
        Training load
      </h2>
      {!trained ? (
        <p className="text-secondary">Weekly training load appears once workouts are completed.</p>
      ) : (
        <>
          <div
            role="region"
            aria-labelledby="load-weeks-caption"
            tabIndex={0}
            className="overflow-x-auto rounded-card bg-surface shadow-card"
          >
            <table className="w-full text-base">
              <caption id="load-weeks-caption" className="px-3 pt-3 text-left font-medium">
                By week (last 8)
              </caption>
              <thead>
                <tr className="border-b border-divider">
                  <th scope="col" className={th}>
                    Week of
                  </th>
                  <th scope="col" className={th}>
                    Workouts
                  </th>
                  <th scope="col" className={th}>
                    Sets
                  </th>
                  <th scope="col" className={th}>
                    Volume ({units})
                  </th>
                  <th scope="col" className={th}>
                    Avg RPE
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...load.weeks].reverse().map((w) => (
                  <tr key={w.weekStart} className="border-b border-divider last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {week(w.weekStart)}
                    </th>
                    <td className={td}>{w.sessions}</td>
                    <td className={td}>{w.sets}</td>
                    <td className={td}>
                      {Math.round(toDisplay(w.volumeKg, units)).toLocaleString('en-GB')}
                    </td>
                    <td className={td}>{w.avgRpe ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {load.muscles.length > 0 && (
            <div
              role="region"
              aria-labelledby="load-muscles-caption"
              tabIndex={0}
              className="overflow-x-auto rounded-card bg-surface shadow-card"
            >
              <table className="w-full text-base">
                <caption id="load-muscles-caption" className="px-3 pt-3 text-left font-medium">
                  Sets by muscle group (last 4 weeks)
                </caption>
                <thead>
                  <tr className="border-b border-divider">
                    <th scope="col" className={th}>
                      Muscle group
                    </th>
                    {recent.map((w) => (
                      <th key={w.weekStart} scope="col" className={th}>
                        {week(w.weekStart)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {load.muscles.map((m) => (
                    <tr key={m} className="border-b border-divider last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        {m}
                      </th>
                      {recent.map((w) => (
                        <td key={w.weekStart} className={td}>
                          {w.setsByMuscle[m] ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
