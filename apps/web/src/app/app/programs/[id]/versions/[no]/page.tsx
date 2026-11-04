import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError, getProgram, getSettings, type SetTarget } from '@kinetic/core';
import { toDisplay, type Units } from '@kinetic/core/units';
import { withServerTenant } from '@/server/serverActor';
import { extraTargets, repsText } from '@/lib/target-text';
import { blockLayout } from '@kinetic/core/workout-blocks';
import { sectionStart } from '@kinetic/core/workout-sections';

export const metadata: Metadata = { title: 'Program version | Repsy' };

/** One target set as read-only text, e.g. "5 reps · 60 kg · RPE 8 · Rest 90 s". */
function describeSet(s: SetTarget, units: Units): string {
  const parts: string[] = [];
  if (s.reps !== undefined) parts.push(`${repsText(s)} reps`);
  if (s.loadKg !== undefined) parts.push(`${toDisplay(s.loadKg, units)} ${units}`);
  if (s.durationSec !== undefined) parts.push(`${s.durationSec} s`);
  if (s.distanceM !== undefined) parts.push(`${s.distanceM} m`);
  parts.push(...extraTargets(s));
  if (s.rpe !== undefined) parts.push(`RPE ${s.rpe}`);
  if (s.tempo) parts.push(`Tempo ${s.tempo}`);
  if (s.restSec !== undefined) parts.push(`Rest ${s.restSec} s`);
  return parts.join(' · ') || 'No targets';
}

/** A saved program version, read-only (S3-1): no inputs, only links back. */
export default async function ProgramVersionPage({
  params,
}: {
  params: Promise<{ id: string; no: string }>;
}) {
  const { id, no } = await params;
  // Anything but a positive integer is an unknown version.
  const versionNo = /^[1-9]\d{0,8}$/.test(no) ? Number(no) : 0;
  let loaded;
  try {
    loaded = await withServerTenant(async (tx, actor) => {
      const program = await getProgram(tx, actor, id, { versionNo });
      const settings = await getSettings(tx, actor);
      return { program, units: settings.profile?.units ?? ('kg' as Units) };
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { program, units } = loaded;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href={`/app/programs/${id}/edit`}
            className="text-sm font-medium text-accent underline"
          >
            Back to editor
          </Link>
          <Link
            href={`/app/programs/${id}/history`}
            className="text-sm font-medium text-accent underline"
          >
            Version history
          </Link>
        </div>
        <h1 className="text-2xl font-semibold break-words md:text-3xl">{program.title}</h1>
        <p className="text-sm text-secondary">
          Version {program.versionNo} · {program.weekCount}{' '}
          {program.weekCount === 1 ? 'week' : 'weeks'} · {program.daysPerWeek}{' '}
          {program.daysPerWeek === 1 ? 'day' : 'days'} per week
        </p>
      </div>

      {program.weeks.map((week, w) => (
        <section key={w} aria-labelledby={`week-${w}`} className="flex flex-col gap-4">
          <h2 id={`week-${w}`} className="text-xl font-semibold">
            Week {w + 1}
          </h2>
          {week.days.map((day, d) => (
            <div
              key={d}
              className="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-4 shadow-card"
            >
              <h3 className="text-lg font-semibold break-words">
                Day {d + 1}: {day.title}
              </h3>
              {day.notes && <p className="text-sm break-words text-secondary">{day.notes}</p>}
              <ul className="flex flex-col gap-3">
                {day.exercises.map((e, i, all) => (
                  <li key={i} className="flex min-w-0 flex-col gap-1">
                    {sectionStart(day.exercises, i) && (
                      <span className="text-sm font-semibold text-secondary uppercase">
                        {sectionStart(day.exercises, i)}
                      </span>
                    )}
                    {blockLayout(all)[i]?.heading && (
                      <span className="text-sm font-medium">{blockLayout(all)[i]?.heading}</span>
                    )}
                    <span className="font-medium break-words">
                      {blockLayout(all)[i]?.label && (
                        <>
                          <span className="mr-2 text-accent">
                            {blockLayout(all)[i]?.label}
                          </span>{' '}
                        </>
                      )}
                      {e.exerciseName}
                    </span>
                    {e.note && <span className="text-sm break-words text-secondary">{e.note}</span>}
                    <ol className="flex flex-col gap-0.5 text-sm">
                      {e.sets.map((s, n) => (
                        <li key={n}>
                          Set {n + 1}: {describeSet(s, units)}
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
