import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DomainError,
  equipmentGuideFor,
  getDraft,
  getProgram,
  getProgramAssignee,
  getSettings,
  type ProgramDetail,
  type ProgramDraftView,
  isManager,
  TRAINER_ROLES,
} from '@kinetic/core';
import type { Units } from '@kinetic/core/units';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { withServerTenant } from '@/server/serverActor';
import { ProgramEditor, type EditorClient } from './ProgramEditor';
import { HouseTemplate, ShareWithClients } from './ShareWithClients';

export const metadata: Metadata = { title: 'Edit program | Repsy' };

type Loaded =
  | {
      editable: true;
      program: ProgramDetail;
      units: Units;
      draft: ProgramDraftView | null;
      client: EditorClient | null;
      /** PRD C20: a team workspace, and whether the viewer can publish house templates. */
      team: boolean;
      manager: boolean;
    }
  | { editable: false; program: ProgramDetail; reason: 'inactive' | 'house' };

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
          return { editable: false, program, reason: 'inactive' };
        }
        // PRD C20: a house template, opened by a coach who can't edit it.
        if (error instanceof DomainError && error.code === 'FORBIDDEN') {
          return { editable: false, program, reason: 'house' };
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
        team:
          (await tx.membership.count({
            where: { status: 'active', role: { in: [...TRAINER_ROLES] } },
          })) > 1,
        manager: isManager(actor.role),
        client: assignee
          ? {
              id: assignee.clientId,
              name: assignee.clientName,
              guide: await equipmentGuideFor(
                tx,
                actor,
                assignee.clientId,
                program.weeks.flatMap((w) =>
                  w.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)),
                ),
              ),
            }
          : null,
      };
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  if (!loaded.editable) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-h1 font-semibold md:text-display">{loaded.program.title}</h1>
        <EmptyState
          title="This program can't be edited"
          body={
            loaded.reason === 'house'
              ? 'This is a house template: only the owner or an admin edits it. Duplicate it from Programs to make your own version.'
              : 'This program is no longer active for this client. Its saved versions stay available.'
          }
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
    <>
      {loaded.program.kind === 'template' && loaded.team && loaded.manager && (
        <HouseTemplate programId={loaded.program.id} initial={loaded.program.house} />
      )}
      {loaded.program.kind === 'template' && (
        <ShareWithClients
          programId={loaded.program.id}
          initial={loaded.program.sharedWithClients}
        />
      )}
      <ProgramEditor
        program={loaded.program}
        units={loaded.units}
        draft={loaded.draft}
        client={loaded.client}
      />
    </>
  );
}
