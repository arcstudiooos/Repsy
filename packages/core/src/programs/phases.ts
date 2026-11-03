import { activeOrgWhere } from '../lapse/lapse';
import { appendAudit, withSystem, withTenant, type PrismaClient, type TenantTx } from '@kinetic/db';
import { TRAINER_ROLES, type ActorContext, type Role } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { assignProgram } from '../assignments/assign';
import { DomainError } from '../errors';
import { raiseFlag } from '../review/rules';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';

/**
 * PRD C17 (phased programs) and J5 (auto-advance). A client's queue of templates runs in order: when the running
 * program's last planned workout is in the past, the next phase starts the next day on the same weekdays (another
 * spread when its days per week differ). In `approve` mode it waits in the review queue as "Next phase ready" until
 * the coach starts it (PRD J7).
 */
export const PHASES_MAX = 6;
export type PhaseMode = 'auto' | 'approve';

export interface PhaseView {
  id: string;
  templateProgramId: string;
  title: string;
  mode: PhaseMode;
  position: number;
}

/** Even spreads for a template whose days per week differ from the last program's. */
const SPREAD: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
};
const addDays = (d: string, n: number) =>
  new Date(toDbDate(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export async function listPhases(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<PhaseView[]> {
  assertCan(actor, 'assignment:read');
  if (!isUuid(clientId)) return [];
  const rows = await tx.programPhase.findMany({
    where: { clientId, status: 'queued' },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      templateProgramId: true,
      mode: true,
      position: true,
      template: { select: { title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    templateProgramId: r.templateProgramId,
    title: r.template.title,
    mode: r.mode as PhaseMode,
    position: r.position,
  }));
}

export async function addPhase(
  tx: TenantTx,
  actor: ActorContext,
  clientId: unknown,
  input: { templateProgramId?: unknown; mode?: unknown },
  opts: { requestId?: string } = {},
): Promise<PhaseView> {
  assertCan(actor, 'assignment:write');
  if (!isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Client not found.');
  if (!isUuid(input.templateProgramId)) throw invalid('templateProgramId', 'Pick a template.');
  const mode: PhaseMode = input.mode === 'approve' ? 'approve' : 'auto';
  const client = await tx.client.findFirst({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new DomainError('NOT_FOUND', 'Client not found.');
  const template = await tx.program.findFirst({
    where: { id: input.templateProgramId, kind: 'template', status: 'active' },
    select: { id: true, title: true, currentVersionId: true },
  });
  if (!template) throw invalid('templateProgramId', 'Pick a template.');
  if (!template.currentVersionId)
    throw invalid('templateProgramId', 'Save the program before queuing it.');
  const queued = await tx.programPhase.findMany({
    where: { clientId, status: 'queued' },
    select: { position: true },
  });
  if (queued.length >= PHASES_MAX)
    throw new DomainError('CONFLICT', `Queue at most ${PHASES_MAX} phases.`);
  const position = Math.max(-1, ...queued.map((q) => q.position)) + 1;
  const row = await tx.programPhase.create({
    data: { clientId, templateProgramId: template.id, mode, position, createdBy: actor.userId },
  } as Parameters<typeof tx.programPhase.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'program_phase',
    objectId: row.id,
    action: 'phase.queued',
    metadata: { clientId, templateProgramId: template.id, mode },
    requestId: opts.requestId,
  });
  return { id: row.id, templateProgramId: template.id, title: template.title, mode, position };
}

export async function removePhase(tx: TenantTx, actor: ActorContext, id: unknown): Promise<void> {
  assertCan(actor, 'assignment:write');
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const { count } = await tx.programPhase.updateMany({
    where: { id, status: 'queued' },
    data: { status: 'cancelled' },
  });
  if (count === 0) throw new DomainError('NOT_FOUND', 'Not found.');
}

/** The running program's last planned day, or null when nothing is planned. */
async function lastPlannedDay(
  tx: TenantTx,
  clientId: string,
): Promise<{ last: string | null; weekdays: number[] }> {
  const active = await tx.programAssignment.findFirst({
    where: { clientId, status: 'active' },
    select: { id: true, weekdays: true },
  });
  if (!active) return { last: null, weekdays: [] };
  const last = await tx.workoutSession.findFirst({
    where: { assignmentId: active.id, kind: 'planned', state: { not: 'cancelled' } },
    orderBy: { scheduledLocalDate: 'desc' },
    select: { scheduledLocalDate: true },
  });
  return { last: last ? fromDbDate(last.scheduledLocalDate) : null, weekdays: active.weekdays };
}

/** Starts the phase now: an ordinary assignment from the day after the current program (never in the past). */
export async function startPhase(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  opts: { now?: Date; requestId?: string } = {},
): Promise<{ assignmentId: string }> {
  assertCan(actor, 'assignment:write');
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const phase = await tx.programPhase.findFirst({
    where: { id, status: 'queued' },
    select: {
      id: true,
      clientId: true,
      templateProgramId: true,
      client: { select: { timezone: true } },
    },
  });
  if (!phase) throw new DomainError('NOT_FOUND', 'Not found.');
  const now = opts.now ?? new Date();
  const today = todayInZone(phase.client.timezone, now);
  const { last, weekdays } = await lastPlannedDay(tx, phase.clientId);
  const start = last && addDays(last, 1) > today ? addDays(last, 1) : today;
  const version = await tx.program.findFirst({
    where: { id: phase.templateProgramId },
    select: { currentVersion: { select: { daysPerWeek: true } } },
  });
  const days = version?.currentVersion?.daysPerWeek ?? weekdays.length;
  const result = await assignProgram(
    tx,
    actor,
    {
      clientId: phase.clientId,
      templateProgramId: phase.templateProgramId,
      startLocalDate: start,
      weekdays: (weekdays.length === days ? weekdays : (SPREAD[days] ?? SPREAD[3]!)) as never,
      readinessConfirmed: true,
      confirmReplace: true,
    },
    { now, requestId: opts.requestId },
  );
  await tx.programPhase.update({
    where: { id: phase.id },
    data: { status: 'started', assignmentId: result.assignmentId, startedAt: now },
  });
  await tx.reviewFlag.updateMany({
    where: { ruleKey: 'phase_ready', sourceId: phase.id, state: { in: ['open', 'snoozed'] } },
    data: {
      state: 'resolved',
      resolvedAt: now,
      resolvedBy: actor.userId,
      resolutionReason: 'Phase started',
    },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'program_phase',
    objectId: phase.id,
    action: 'phase.started',
    metadata: {
      clientId: phase.clientId,
      assignmentId: result.assignmentId,
      startLocalDate: start,
    },
    requestId: opts.requestId,
  });
  return { assignmentId: result.assignmentId };
}

/**
 * Worker: for each client whose running program has nothing left planned from today, starts the next `auto` phase,
 * or raises "Next phase ready" for an `approve` one. Auto phases run as the coach who queued them (or the owner if
 * that coach has left). Each organization runs in its own tenant transaction.
 */
export async function advancePhases(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ started: number; flagged: number }> {
  const heads = await withSystem(
    (tx) =>
      tx.programPhase.findMany({
        where: { status: 'queued', organization: activeOrgWhere(now) },
        orderBy: [{ clientId: 'asc' }, { position: 'asc' }],
        distinct: ['clientId'],
        select: { id: true, organizationId: true, clientId: true, mode: true, createdBy: true },
      }),
    prisma,
  );
  let started = 0;
  let flagged = 0;
  for (const p of heads) {
    try {
      const done = await withTenant(
        p.organizationId,
        async (tx) => {
          const client = await tx.client.findFirst({
            where: { id: p.clientId, status: 'active' },
            select: { timezone: true },
          });
          if (!client) return null;
          const today = todayInZone(client.timezone, now);
          const { last } = await lastPlannedDay(tx, p.clientId);
          // Still running: something planned today or later.
          if (last && last >= today) return null;
          if (p.mode === 'approve') {
            const made = await raiseFlag(tx, {
              clientId: p.clientId,
              ruleKey: 'phase_ready',
              sourceType: 'assignment',
              sourceId: p.id,
              dedupeKey: `phase_ready:${p.id}`,
              evidence: { phaseId: p.id },
            });
            return made ? 'flagged' : null;
          }
          const members = await tx.membership.findMany({
            where: { status: 'active', role: { in: [...TRAINER_ROLES] } },
            select: { userId: true, role: true },
          });
          const by =
            members.find((m) => m.userId === p.createdBy) ??
            members.find((m) => m.role === 'owner');
          if (!by) return null;
          const actor: ActorContext = {
            userId: by.userId,
            orgId: p.organizationId,
            role: by.role as Role,
            isPlatformAdmin: false,
          };
          await startPhase(tx, actor, p.id, { now });
          return 'started';
        },
        prisma,
      );
      if (done === 'started') started += 1;
      if (done === 'flagged') flagged += 1;
    } catch {
      // One client's phase failing (an archived template) never stops the others; the next run retries.
    }
  }
  return { started, flagged };
}
