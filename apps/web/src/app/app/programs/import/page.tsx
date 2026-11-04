import type { Metadata } from 'next';
import { getSettings } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';
import { ImportProgram } from './ImportProgram';

export const metadata: Metadata = { title: 'Import a program | Repsy' };

/** Paste a program as text or from a spreadsheet; review the matches; save as a new template (PRD C14). */
export default async function ImportProgramPage() {
  const settings = await withServerTenant((tx, actor) => getSettings(tx, actor));
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Import a program</h1>
      <p className="mb-6 max-w-prose text-secondary">
        Paste a workout plan as text, one exercise per line under day headings (for example{' '}
        <code>Day 1: Upper</code> then <code>Bench press 3x8 @ 60kg</code>), or copy rows from a
        spreadsheet with Day, Exercise, Sets, Reps and Load columns. You check every exercise before
        anything is saved.
      </p>
      <ImportProgram defaultUnits={settings.profile?.units ?? 'kg'} />
    </>
  );
}
