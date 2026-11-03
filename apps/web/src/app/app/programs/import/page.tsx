import type { Metadata } from 'next';
import { aiRoleAllowed, getSettings } from '@kinetic/core';
import { aiPortFromEnv } from '@/server/ai/anthropic';
import { loadAllTemplates } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';
import { ImportProgram } from './ImportProgram';

export const metadata: Metadata = { title: 'Import a program | Kinetic' };

/** Paste a program as text or from a spreadsheet; review the matches; save as a new template (PRD C14). */
export default async function ImportProgramPage() {
  const { settings, ai } = await withServerTenant(async (tx, actor) => {
    // PRD I10, I11: offered to trainers when the owner has turned AI drafting on.
    const on =
      aiRoleAllowed(actor) &&
      aiPortFromEnv() !== null &&
      ((await tx.organization.findFirst({ select: { aiEnabled: true } }))?.aiEnabled ?? false);
    return {
      settings: await getSettings(tx, actor),
      ai: on
        ? {
            templates: (await loadAllTemplates(tx, actor)).items
              .filter((p) => p.versionNo !== null)
              .map((p) => ({ id: p.id, title: p.title })),
          }
        : null,
    };
  });
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Import a program</h1>
      <p className="mb-6 max-w-prose text-secondary">
        Paste a workout plan as text, one exercise per line under day headings (for example{' '}
        <code>Day 1: Upper</code> then <code>Bench press 3x8 @ 60kg</code>), or copy rows from a
        spreadsheet with Day, Exercise, Sets, Reps and Load columns. You check every exercise before
        anything is saved.
      </p>
      <ImportProgram defaultUnits={settings.profile?.units ?? 'kg'} ai={ai} />
    </>
  );
}
