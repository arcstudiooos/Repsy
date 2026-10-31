import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { logger } from '../log';
import type { TrackingType } from '../exercises/options';
import { decodeCursor, encodeCursor, PAGE_SIZE } from '../pagination';
import { escapeLike } from '../clients/clients';
import { isUuid } from '../uuid';
import { TITLE_MAX } from './commit';
import { assertEditableProgram } from './drafts';
import type { SetTarget } from './targets';

const NUMERIC_TARGET_FIELDS = [
  'reps',
  'loadKg',
  'rpe',
  'restSec',
  'durationSec',
  'distanceM',
] as const;

/**
 * Lenient history read of stored targets. They were validated when committed, and history must keep rendering even
 * after targetSchema tightens, so bounds are never re-applied. Unexpected shapes degrade instead of failing the page:
 * a non-array becomes [] (logged without values), non-object items are dropped, and each set keeps only its finite
 * numeric fields plus a string `tempo`.
 */
export function readStoredTargets(json: unknown): SetTarget[] {
  if (!Array.isArray(json)) {
    logger.warn({ event: 'stored_targets_shape' }, 'Stored workout targets are not an array.');
    return [];
  }
  return json.flatMap((item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    const set: Record<string, number | string> = {};
    for (const key of NUMERIC_TARGET_FIELDS) {
      const v = raw[key];
      if (typeof v === 'number' && Number.isFinite(v)) set[key] = v;
    }
    if (typeof raw.tempo === 'string') set.tempo = raw.tempo;
    return [set as SetTarget];
  });
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export function cleanTitle(title: string): string {
  const t = title.trim();
  if (t.length < 1 || t.length > TITLE_MAX) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      title: [`Use 1-${TITLE_MAX} characters.`],
    });
  }
  return t;
}

export interface ProgramSummary {
  id: string;
  title: string;
  kind: 'template' | 'client';
  versionNo: number | null;
  daysPerWeek: number | null;
  weekCount: number | null;
  updatedAt: string;
  /** Distinct clients whose active assignment runs a copy of this template (0 for client copies). */
  activeClientCount: number;
}

export interface ProgramDetail {
  id: string;
  title: string;
  kind: 'template' | 'client';
  /** Null until the first commit. */
  versionNo: number | null;
  versionId: string | null;
  daysPerWeek: number;
  weekCount: number;
  weeks: {
    days: {
      title: string;
      notes: string;
      exercises: {
        exerciseId: string;
        exerciseName: string;
        trackingType: TrackingType;
        note: string | null;
        sets: SetTarget[];
      }[];
    }[];
  }[];
}

export async function createProgram(
  tx: TenantTx,
  actor: ActorContext,
  input: { title: string },
  opts: { requestId?: string } = {},
): Promise<ProgramSummary> {
  assertCan(actor, 'program:write');
  const row = await tx.program.create({
    data: { title: cleanTitle(input.title), createdBy: actor.userId },
  } as Parameters<typeof tx.program.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'program',
    objectId: row.id,
    action: 'program.created',
    requestId: opts.requestId,
  });
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    versionNo: null,
    daysPerWeek: null,
    weekCount: null,
    updatedAt: row.updatedAt.toISOString(),
    activeClientCount: 0,
  };
}

export async function renameProgram(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  title: string,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'program:write');
  // A template, or the client copy of that client's active assignment (Ruling 1); unknown ids and other orgs are
  // NOT_FOUND, any other client copy is CONFLICT. Renaming a client copy never touches the template it came from.
  await assertEditableProgram(tx, id);
  const { count } = await tx.program.updateMany({
    where: { id },
    data: { title: cleanTitle(title) },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'program',
    objectId: id,
    action: 'program.renamed',
    requestId: opts.requestId,
  });
}

export async function listPrograms(
  tx: TenantTx,
  actor: ActorContext,
  query: { kind: 'template'; cursor?: string; q?: string; status?: 'active' | 'archived' },
): Promise<{ items: ProgramSummary[]; nextCursor: string | null }> {
  assertCan(actor, 'program:read');
  const and: Record<string, unknown>[] = [{ kind: query.kind, status: query.status ?? 'active' }];
  if (query.q !== undefined) {
    const q = query.q.trim();
    if (q.length < 1 || q.length > TITLE_MAX) {
      throw new DomainError('VALIDATION', 'Some fields are invalid.', {
        q: [`Use 1-${TITLE_MAX} characters.`],
      });
    }
    and.push({ title: { contains: escapeLike(q), mode: 'insensitive' } });
  }
  if (query.cursor !== undefined) {
    const c = decodeCursor(query.cursor);
    and.push({
      OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }],
    });
  }
  const rows = await tx.program.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    include: {
      currentVersion: { select: { versionNo: true, daysPerWeek: true, weekCount: true } },
    },
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  // Usage (read-only, D-001 #7): an assignment runs the client's own copy, linked to its template by sourceProgramId.
  const running = page.length
    ? await tx.programAssignment.findMany({
        where: { status: 'active', program: { sourceProgramId: { in: page.map((r) => r.id) } } },
        select: { clientId: true, program: { select: { sourceProgramId: true } } },
      })
    : [];
  const clientsByTemplate = new Map<string, Set<string>>();
  for (const a of running) {
    const source = a.program.sourceProgramId;
    if (!source) continue;
    const set = clientsByTemplate.get(source) ?? new Set<string>();
    set.add(a.clientId);
    clientsByTemplate.set(source, set);
  }
  return {
    items: page.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      versionNo: r.currentVersion?.versionNo ?? null,
      daysPerWeek: r.currentVersion?.daysPerWeek ?? null,
      weekCount: r.currentVersion?.weekCount ?? null,
      updatedAt: r.updatedAt.toISOString(),
      activeClientCount: clientsByTemplate.get(r.id)?.size ?? 0,
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

/**
 * The program at its current version, or at `opts.versionId` / `opts.versionNo` (an older committed version of the
 * same program, read-only). An unknown version is NOT_FOUND.
 */
export async function getProgram(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { versionId?: string; versionNo?: number } = {},
): Promise<ProgramDetail> {
  assertCan(actor, 'program:read');
  if (!isUuid(id)) throw notFound();
  const program = await tx.program.findFirst({ where: { id } });
  if (!program) throw notFound();

  let wanted = opts.versionId ?? program.currentVersionId;
  if (opts.versionNo !== undefined) {
    if (!Number.isInteger(opts.versionNo)) throw notFound();
    const byNo = await tx.programVersion.findFirst({
      where: { programId: id, versionNo: opts.versionNo },
      select: { id: true },
    });
    if (!byNo) throw notFound();
    wanted = byNo.id;
  }
  const base = { id: program.id, title: program.title, kind: program.kind };
  if (wanted === null) {
    return { ...base, versionNo: null, versionId: null, daysPerWeek: 0, weekCount: 0, weeks: [] };
  }
  if (!isUuid(wanted)) throw notFound();
  const version = await tx.programVersion.findFirst({ where: { id: wanted, programId: id } });
  if (!version) throw notFound();

  const slots = await tx.programSlot.findMany({
    where: { programVersionId: version.id },
    orderBy: [{ weekIndex: 'asc' }, { dayIndex: 'asc' }],
    include: {
      workoutVersion: {
        include: {
          exercises: {
            orderBy: { position: 'asc' },
            include: { exercise: { select: { name: true, trackingType: true } } },
          },
        },
      },
    },
  });
  const weeks: ProgramDetail['weeks'] = Array.from({ length: version.weekCount }, () => ({
    days: [],
  }));
  for (const slot of slots) {
    const wv = slot.workoutVersion;
    weeks[slot.weekIndex]?.days.push({
      title: wv.title,
      notes: wv.notes,
      exercises: wv.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        exerciseName: e.exercise.name,
        trackingType: e.exercise.trackingType,
        note: e.note,
        sets: readStoredTargets(e.targetJson),
      })),
    });
  }
  return {
    ...base,
    versionNo: version.versionNo,
    versionId: version.id,
    daysPerWeek: version.daysPerWeek,
    weekCount: version.weekCount,
    weeks,
  };
}
