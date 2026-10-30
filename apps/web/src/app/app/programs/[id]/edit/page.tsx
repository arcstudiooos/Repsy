import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DomainError, getProgram, getSettings, type ProgramDetail } from '@kinetic/core';
import type { Units } from '@kinetic/core/units';
import { withServerTenant } from '@/server/serverActor';
import { ProgramEditor } from './ProgramEditor';

export const metadata: Metadata = { title: 'Edit program | Kinetic' };

export default async function EditProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let loaded: { program: ProgramDetail; units: Units };
  try {
    loaded = await withServerTenant(async (tx, actor) => {
      const program = await getProgram(tx, actor, id);
      const settings = await getSettings(tx, actor);
      return { program, units: settings.profile?.units ?? 'kg' };
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  return <ProgramEditor program={loaded.program} units={loaded.units} />;
}
