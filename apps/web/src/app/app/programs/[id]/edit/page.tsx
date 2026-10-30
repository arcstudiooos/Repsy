import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DomainError,
  getDraft,
  getProgram,
  getProgramAssignee,
  getSettings,
  type ProgramDetail,
  type ProgramDraftView,
} from '@kinetic/core';
import type { Units } from '@kinetic/core/units';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { withServerTenant } from '@/server/serverActor';
import { ProgramEditor, type EditorClient } from './ProgramEditor';

export const metadata: Metadata = { title: 'Edit program | Kinetic' };

type Loaded =
  | {
      editable: true;
      program: ProgramDetail;
      units: Units;
      draft: ProgramDraftView | null;
      client: EditorClient | null;
    }
  | { editable: false; program: ProgramDetail };

/**
 * Templates and the client copy of a client's active assignment open in the builder (Ruling 1). Any other client
 * copy (its assignment ended or was replaced) shows a read-only notice with a link to its saved versions.
 */
export default async function EditProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let loaded: Loaded;
  try {
    loaded = await withServerTenant(async (tx, actor): Promise<Loaded> => {
      const program = await getProgram(tx, actor, id);
      let draft: ProgramDraftView | null;
      try {
        draft = await getDraft(tx, actor, id);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'CONFLICT') {
          return { editable: false, program };
        }
        throw error;
      }
      const settings = await getSettings(tx, actor);
      const assignee =
        program.kind === 'client' ? await getProgramAssignee(tx, actor, program.id) : null;
      return {
        editable: true,
        program,
        units: settings.profile?.units ?? 'kg',
        draft,
        client: assignee ? { id: assignee.clientId, name: assignee.clientName } : null,
      };
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  if (!loaded.editable) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold md:text-3xl">{loaded.program.title}</h1>
        <EmptyState
          title="This program can't be edited"
          body="This program is no longer active for this client. Its saved versions stay available."
          action={
            loaded.program.versionNo !== null ? (
              <Link
                href={`/app/programs/${loaded.program.id}/history`}
                className={buttonVariants({ variant: 'secondary' })}
              >
                Version history
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }
  return (
    <ProgramEditor
      program={loaded.program}
      units={loaded.units}
      draft={loaded.draft}
      client={loaded.client}
    />
  );
}
