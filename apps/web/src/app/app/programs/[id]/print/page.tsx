import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { DomainError, getProgram, getSettings, type SetTarget } from '@kinetic/core';
import { toDisplay, type Units } from '@kinetic/core/units';
import { blockLayout } from '@kinetic/core/workout-blocks';
import { sectionStart } from '@kinetic/core/workout-sections';
import { withServerTenant } from '@/server/serverActor';
import { PrintButton } from './PrintButton';
import { extraTargets, repsText } from '@/lib/target-text';

export const metadata: Metadata = { title: 'Print program | Repsy' };

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
  return parts.join(' · ') || '–';
}

/** A printable program (PRD C15): the current version, one block per day; the browser saves it as a PDF. */
export default async function PrintProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    data = await withServerTenant(async (tx, actor) => {
      const settings = await getSettings(tx, actor);
      return {
        program: await getProgram(tx, actor, id),
        org: settings.org,
        units: settings.profile?.units ?? ('kg' as Units),
      };
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { program, org, units } = data;
  return (
    <article className="flex flex-col gap-6 text-ink">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/app/programs/${program.id}/edit`}
          className="text-accent underline underline-offset-4"
        >
          Back to the program
        </Link>
        <PrintButton />
      </div>
      <header>
        <h1 className="text-2xl font-semibold">{program.title}</h1>
        <p className="text-secondary">
          {org?.name ? `${org.name} · ` : ''}
          {program.versionNo === null
            ? 'Not saved yet'
            : `${program.weekCount} ${program.weekCount === 1 ? 'week' : 'weeks'} · ${program.daysPerWeek} ${program.daysPerWeek === 1 ? 'day' : 'days'} per week · Version ${program.versionNo}`}
        </p>
      </header>
      {program.weeks.map((w, wi) => (
        <section
          key={wi}
          aria-labelledby={`week-${wi}`}
          className="flex flex-col gap-3 break-inside-avoid-page"
        >
          <h2 id={`week-${wi}`} className="text-xl font-semibold">
            Week {wi + 1}
          </h2>
          {w.days.map((d, di) => (
            <div
              key={di}
              className="break-inside-avoid rounded-card border border-input-border p-4"
            >
              <h3 className="font-semibold">{d.title}</h3>
              {d.notes && (
                <p className="mb-2 text-sm whitespace-pre-line text-secondary">{d.notes}</p>
              )}
              <table className="w-full text-left text-sm">
                <thead className="text-secondary">
                  <tr>
                    <th scope="col" className="py-1 pr-4 font-medium">
                      Exercise
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Sets
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.exercises.map((e, ei, all) => (
                    <Fragment key={ei}>
                      {sectionStart(d.exercises, ei) && (
                        <tr className="border-t border-divider">
                          <th
                            scope="colgroup"
                            colSpan={2}
                            className="pt-2 pb-1 text-left font-semibold"
                          >
                            {sectionStart(d.exercises, ei)}
                          </th>
                        </tr>
                      )}
                      {blockLayout(all)[ei]?.heading && (
                        <tr className="border-t border-divider">
                          <td colSpan={2} className="pt-2 pb-1 font-medium">
                            {blockLayout(all)[ei]?.heading}
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-divider align-top">
                        <th scope="row" className="py-1 pr-4 font-medium">
                          {blockLayout(all)[ei]?.label && (
                            <>
                              <span className="mr-2">{blockLayout(all)[ei]?.label}</span>{' '}
                            </>
                          )}
                          {e.exerciseName}
                          {e.note && (
                            <span className="block font-normal text-secondary">{e.note}</span>
                          )}
                        </th>
                        <td className="py-1">
                          <ol className="list-inside list-decimal">
                            {e.sets.map((s, si) => (
                              <li key={si}>{describeSet(s, units)}</li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}
