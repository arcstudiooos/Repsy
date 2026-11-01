import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { commitProgramVersion, TITLE_MAX, type WeekInput } from './commit';
import { getProgram, type ProgramSummary } from './read';

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

async function findTemplate(tx: TenantTx, id: string) {
  if (!isUuid(id)) throw notFound();
  // Templates only: a client's own copy is never duplicated or archived from the library.
  const row = await tx.program.findFirst({
    where: { id, kind: 'template' },
    select: { id: true, title: true, status: true },
  });
  if (!row) throw notFound();
  return row;
}

/** "Copy of <title>", cut to fit the title limit. */
export function copyTitle(title: string): string {
  const t = `Copy of ${title}`;
  return t.length <= TITLE_MAX ? t : `${t.slice(0, TITLE_MAX - 1)}…`;
}

/**
 * Duplicates a template (PRD C13): a new active template titled "Copy of …" whose first version is the source's
 * current version. A never-saved source gives an empty new template. The source and its clients are untouched.
 */
export async function duplicateTemplate(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string } = {},
): Promise<ProgramSummary> {
  assertCan(actor, 'program:write');
  const source = await findTemplate(tx, id);
  const detail = await getProgram(tx, actor, source.id);
  const created = await tx.program.create({
    data: { title: copyTitle(source.title), createdBy: actor.userId },
  } as Parameters<typeof tx.program.create>[0]);
  let versionNo: number | null = null;
  if (detail.versionNo !== null) {
    const weeks: WeekInput[] = detail.weeks.map((w) => ({
      days: w.days.map((d) => ({
        title: d.title,
        notes: d.notes,
        exercises: d.exercises.map((e) => ({
          exerciseId: e.exerciseId,
          ...(e.note ? { note: e.note } : {}),
          ...(e.section !== 'main' ? { section: e.section } : {}),
          ...(e.groupWithPrevious ? { groupWithPrevious: true } : {}),
          ...(e.block ? { block: e.block } : {}),
          sets: e.sets,
        })),
      })),
    }));
    ({ versionNo } = await commitProgramVersion(
      tx,
      actor,
      { programId: created.id, expectedVersionNo: null, weeks },
      opts,
    ));
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'program',
    objectId: created.id,
    action: 'program.duplicated',
    requestId: opts.requestId,
  });
  return {
    id: created.id,
    title: created.title,
    kind: 'template',
    versionNo,
    daysPerWeek: detail.versionNo === null ? null : detail.daysPerWeek,
    weekCount: detail.versionNo === null ? null : detail.weekCount,
    updatedAt: created.updatedAt.toISOString(),
    activeClientCount: 0,
    house: false,
  };
}

/**
 * Archives or restores a template (PRD C13). An archived template leaves the library and can't be assigned; clients
 * already running a copy keep it (their copy is separate, D-001). Repeating the current state is a no-op.
 */
export async function setTemplateArchived(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  archived: boolean,
  opts: { requestId?: string } = {},
): Promise<{ id: string; status: 'active' | 'archived' }> {
  assertCan(actor, 'program:write');
  const source = await findTemplate(tx, id);
  const status = archived ? 'archived' : 'active';
  if (source.status !== status) {
    await tx.program.update({ where: { id: source.id }, data: { status } });
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'program',
      objectId: source.id,
      action: archived ? 'program.archived' : 'program.restored',
      requestId: opts.requestId,
    });
  }
  return { id: source.id, status };
}
