import { STATE_COLOR, STATE_LABEL, type SessionStateKey } from './palette';

export interface HeatCell {
  /** YYYY-MM-DD. */
  date: string;
  state: SessionStateKey | null;
}

const fmt = (d: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );

/**
 * One cell per day for N weeks (columns = weeks, rows = Mon..Sun), coloured by the scheduled session's state;
 * empty days are unscheduled. Each cell has a title for pointer users; the summary is on the ChartFrame.
 */
export function ConsistencyHeatmap({ cells }: { cells: HeatCell[] }) {
  const weeks: HeatCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <div aria-hidden className="flex gap-1 overflow-x-auto pb-1">
      <div className="mr-1 flex flex-col gap-1 pt-0">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="flex h-4 items-center text-micro text-secondary">
            {i % 2 === 0 ? d : ''}
          </span>
        ))}
      </div>
      {weeks.map((w) => (
        <div key={w[0]!.date} className="flex flex-col gap-1">
          {w.map((c) => (
            <span
              key={c.date}
              title={`${fmt(c.date)}: ${c.state ? STATE_LABEL[c.state] : 'nothing scheduled'}`}
              className="size-4 rounded-[4px] border border-border"
              style={
                c.state
                  ? { background: STATE_COLOR[c.state], borderColor: 'transparent' }
                  : undefined
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
