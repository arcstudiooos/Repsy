import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { MAX_WEEKS, TITLE_MAX } from './commit';

/** Serialized `draftJson` limit (S3-1). */
export const MAX_DRAFT_BYTES = 1_048_576;

export interface ProgramDraftView {
  baseVersionNo: number | null;
  title: string | null;
  weeks: unknown[];
  updatedAt: string;
  updatedBy: { id: string; name: string };
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

/**
 * Throws unless `programId` is a program this org can edit through the builder: a template, or the client copy of
 * that client's active assignment (Ruling 1). Unknown id and other orgs are NOT_FOUND (the tenant scope hides them);
 * any other client copy is CONFLICT. Task 3.2 reuses this for client-copy commits.
 */
export async function assertEditableProgram(
  tx: TenantTx,
  programId: string,
): Promise<{ id: string; kind: 'template' | 'client' }> {
  if (!isUuid(programId)) throw notFound();
  const program = await tx.program.findFirst({
    where: { id: programId },
    select: { id: true, kind: true },
  });
  if (!program) throw notFound();
  if (program.kind === 'client') {
    const active = await tx.programAssignment.findFirst({
      where: { programId, status: 'active' },
      select: { id: true },
    });
    if (!active) {
      throw new DomainError('CONFLICT', 'This program is no longer active for this client.');
    }
  }
  return program;
}

const invalidWeeks = (message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { weeks: [message] });

export async function saveDraft(
  tx: TenantTx,
  actor: ActorContext,
  programId: string,
  input: { baseVersionNo: number | null; title?: string; weeks: unknown },
): Promise<{ updatedAt: string }> {
  assertCan(actor, 'program:write');
  await assertEditableProgram(tx, programId);

  const { baseVersionNo, title, weeks } = input;
  if (baseVersionNo !== null && (!Number.isInteger(baseVersionNo) || baseVersionNo < 1)) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      baseVersionNo: ['Must be a version number or null.'],
    });
  }
  if (title !== undefined && (typeof title !== 'string' || title.length > TITLE_MAX)) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      title: [`Use at most ${TITLE_MAX} characters.`],
    });
  }
  if (!Array.isArray(weeks)) throw invalidWeeks('Weeks must be a list.');
  if (weeks.length > MAX_WEEKS) throw invalidWeeks(`Use at most ${MAX_WEEKS} weeks.`);

  const draftJson = title === undefined ? { weeks } : { title, weeks };
  if (Buffer.byteLength(JSON.stringify(draftJson), 'utf8') > MAX_DRAFT_BYTES) {
    throw invalidWeeks('This draft is too large to save.');
  }

  // Scalar FKs only; the tenant extension injects organizationId on create.
  const row = await tx.programDraft.upsert({
    where: { programId },
    create: { programId, baseVersionNo, draftJson, updatedBy: actor.userId },
    update: { baseVersionNo, draftJson, updatedBy: actor.userId },
  } as unknown as Parameters<typeof tx.programDraft.upsert>[0]);
  return { updatedAt: row.updatedAt.toISOString() };
}

export async function getDraft(
  tx: TenantTx,
  actor: ActorContext,
  programId: string,
): Promise<ProgramDraftView | null> {
  assertCan(actor, 'program:read');
  await assertEditableProgram(tx, programId);
  const row = await tx.programDraft.findFirst({
    where: { programId },
    include: { editor: { select: { id: true, name: true } } },
  });
  if (!row) return null;
  const json = (row.draftJson ?? {}) as { title?: unknown; weeks?: unknown };
  return {
    baseVersionNo: row.baseVersionNo,
    title: typeof json.title === 'string' ? json.title : null,
    weeks: Array.isArray(json.weeks) ? json.weeks : [],
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: { id: row.editor.id, name: row.editor.name },
  };
}

/** Idempotent: discarding a missing draft succeeds. */
export async function discardDraft(
  tx: TenantTx,
  actor: ActorContext,
  programId: string,
): Promise<void> {
  assertCan(actor, 'program:write');
  await assertEditableProgram(tx, programId);
  await tx.programDraft.deleteMany({ where: { programId } });
}
