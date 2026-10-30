import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

export interface ProgramVersionListItem {
  versionNo: number;
  committedAt: string;
  committedBy: { id: string; name: string };
}

/** Committed versions of a program, newest first. */
export async function listProgramVersions(
  tx: TenantTx,
  actor: ActorContext,
  programId: string,
): Promise<ProgramVersionListItem[]> {
  assertCan(actor, 'program:read');
  if (!isUuid(programId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const program = await tx.program.findFirst({ where: { id: programId }, select: { id: true } });
  if (!program) throw new DomainError('NOT_FOUND', 'Not found.');
  const rows = await tx.programVersion.findMany({
    where: { programId },
    orderBy: { versionNo: 'desc' },
    select: {
      versionNo: true,
      committedAt: true,
      committer: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    versionNo: r.versionNo,
    committedAt: r.committedAt.toISOString(),
    committedBy: { id: r.committer.id, name: r.committer.name },
  }));
}
