import { appendAudit, withSystem, withTenant, type PrismaClient, type TenantTx } from '@kinetic/db';
import { TRAINER_ROLES, type ActorContext, type Role } from '../authz/actor';
import { assignProgram } from '../assignments/assign';
import { sendForm } from '../checkins/checkins';
import { DomainError } from '../errors';
import { createHabit } from '../habits/habits';
import { getClientThread, sendMessage } from '../messages/messages';
import { createFollowup } from '../review/flags';
import { raiseFlag } from '../review/rules';
import { toDbDate } from '../sessions/read';
import { todayInZone, zonedTimeToUtc } from '../timezone';

/**
 * PRD J1, J3, J7, J8: the automation engine. A run gives each step a due time (day N after the start, at the step's
 * time in the client's zone). The worker runs due steps as the sequence's coach (the owner if they have left). An
 * "ask first" step waits for approval in the review queue; a failed step is kept with its reason and raises "Needs
 * review". Steps are written to run once: messages use the step run's id as their idempotency key.
 */
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
const str = (c: unknown, k: string) => {
  const v = (c as Record<string, unknown> | null)?.[k];
  return typeof v === 'string' ? v : '';
};

/** Starts `sequenceId` for the client unless it is already running for them. Returns whether it started. */
export async function startRun(
  tx: TenantTx,
  sequenceId: string,
  clientId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const sequence = await tx.sequence.findFirst({
    where: { id: sequenceId, archivedAt: null },
    select: {
      id: true,
      steps: {
        // Retired steps (sequences.ts RETIRED) belong to older runs only.
        where: { position: { lt: 10_000 } },
        orderBy: { position: 'asc' },
        select: { id: true, dayOffset: true, localTime: true },
      },
    },
  });
  const client = await tx.client.findFirst({
    where: { id: clientId, status: { in: ['active', 'invited'] } },
    select: { timezone: true },
  });
  if (!sequence || !client) return false;
  if (await tx.sequenceRun.count({ where: { sequenceId, clientId, status: 'active' } }))
    return false;
  const run = await tx.sequenceRun.create({
    data: { sequenceId, clientId, startedAt: now },
  } as Parameters<typeof tx.sequenceRun.create>[0]);
  const start = todayInZone(client.timezone, now);
  for (const step of sequence.steps) {
    const due =
      zonedTimeToUtc(addDays(start, step.dayOffset), step.localTime, client.timezone) ?? now;
    await tx.sequenceStepRun.create({
      data: { runId: run.id, stepId: step.id, dueAt: due < now ? now : due },
    } as Parameters<typeof tx.sequenceStepRun.create>[0]);
  }
  if (sequence.steps.length === 0) {
    await tx.sequenceRun.update({ where: { id: run.id }, data: { status: 'done', endedAt: now } });
  }
  return true;
}

/** One step, done now as `actor`. Throws a DomainError when it can't be done (kept as the step's failure). */
async function perform(
  tx: TenantTx,
  actor: ActorContext,
  stepRunId: string,
  step: { type: string; configJson: unknown },
  clientId: string,
  now: Date,
): Promise<void> {
  const c = step.configJson;
  switch (step.type) {
    case 'message': {
      const thread = await getClientThread(tx, actor, clientId);
      await sendMessage(
        tx,
        actor,
        thread.id,
        { body: str(c, 'body'), clientMessageId: stepRunId },
        { now },
      );
      return;
    }
    case 'form':
      await sendForm(tx, actor, clientId, str(c, 'templateId'), { now });
      return;
    case 'habit':
      await createHabit(
        tx,
        actor,
        clientId,
        {
          title: str(c, 'title'),
          daysPerWeek: (c as { daysPerWeek?: number }).daysPerWeek ?? 7,
        },
        { now },
      );
      return;
    case 'tag_add':
    case 'tag_remove': {
      const tag = await tx.clientTag.findFirst({
        where: { id: str(c, 'tagId') },
        select: { id: true },
      });
      if (!tag) throw new DomainError('NOT_FOUND', 'That tag no longer exists.');
      if (step.type === 'tag_add') {
        await tx.clientTagLink.createMany({
          data: [{ clientId, tagId: tag.id }] as never,
          skipDuplicates: true,
        });
      } else {
        await tx.clientTagLink.deleteMany({ where: { clientId, tagId: tag.id } });
      }
      return;
    }
    case 'program': {
      const template = await tx.program.findFirst({
        where: { id: str(c, 'templateProgramId'), kind: 'template' },
        select: { id: true, currentVersion: { select: { daysPerWeek: true } } },
      });
      if (!template?.currentVersion)
        throw new DomainError('NOT_FOUND', 'That program is not saved or no longer exists.');
      const client = await tx.client.findFirstOrThrow({
        where: { id: clientId },
        select: { timezone: true },
      });
      await assignProgram(
        tx,
        actor,
        {
          clientId,
          templateProgramId: template.id,
          startLocalDate: todayInZone(client.timezone, now),
          weekdays: (SPREAD[template.currentVersion.daysPerWeek] ?? SPREAD[3]!) as never,
          readinessConfirmed: true,
          confirmReplace: true,
        },
        { now },
      );
      return;
    }
    case 'followup':
      await createFollowup(tx, actor, {
        clientId,
        title: str(c, 'title') || 'Automation follow-up',
      });
      return;
    default:
      throw new DomainError('VALIDATION', 'Unknown step.');
  }
}

async function finishRunIfDone(tx: TenantTx, runId: string, now: Date) {
  const open = await tx.sequenceStepRun.count({
    where: { runId, status: { in: ['pending', 'waiting'] } },
  });
  if (open === 0) {
    await tx.sequenceRun.updateMany({
      where: { id: runId, status: 'active' },
      data: { status: 'done', endedAt: now },
    });
  }
}

/** Runs one step run now (worker, or the coach approving it). Failures are recorded, never thrown. */
export async function executeStepRun(
  tx: TenantTx,
  actor: ActorContext,
  stepRunId: string,
  now: Date = new Date(),
): Promise<'done' | 'failed'> {
  const sr = await tx.sequenceStepRun.findFirstOrThrow({
    where: { id: stepRunId },
    select: {
      id: true,
      runId: true,
      run: { select: { clientId: true, sequence: { select: { name: true } } } },
      step: { select: { type: true, configJson: true } },
    },
  });
  try {
    // A savepoint would be ideal; core writes are idempotent enough that a failed step leaves nothing half-done.
    await perform(tx, actor, sr.id, sr.step, sr.run.clientId, now);
    await tx.sequenceStepRun.update({
      where: { id: sr.id },
      data: { status: 'done', executedAt: now, error: null },
    });
    await finishRunIfDone(tx, sr.runId, now);
    return 'done';
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await tx.sequenceStepRun.update({
      where: { id: sr.id },
      data: { status: 'failed', executedAt: now, error: error.message.slice(0, 300) },
    });
    // PRD J8: a failed step raises "Needs review".
    await raiseFlag(tx, {
      clientId: sr.run.clientId,
      ruleKey: 'automation_failed',
      sourceType: 'client',
      sourceId: sr.id,
      dedupeKey: `automation_failed:${sr.id}`,
      evidence: { stepRunId: sr.id },
    });
    await finishRunIfDone(tx, sr.runId, now);
    return 'failed';
  }
}

async function actorFor(
  tx: TenantTx,
  orgId: string,
  preferredUserId: string,
): Promise<ActorContext | null> {
  const members = await tx.membership.findMany({
    where: { status: 'active', role: { in: [...TRAINER_ROLES] } },
    select: { userId: true, role: true },
  });
  const by =
    members.find((m) => m.userId === preferredUserId) ?? members.find((m) => m.role === 'owner');
  return by ? { userId: by.userId, orgId, role: by.role as Role, isPlatformAdmin: false } : null;
}

/** Worker, part 1: turns new client events into runs of the sequences they trigger. */
export async function processClientEvents(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const events = await withSystem(
    (tx) =>
      tx.clientEvent.findMany({
        where: { processedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 500,
        select: { id: true, organizationId: true, clientId: true, kind: true, detailJson: true },
      }),
    prisma,
  );
  let started = 0;
  for (const e of events) {
    await withTenant(
      e.organizationId,
      async (tx) => {
        const detail = (e.detailJson ?? {}) as Record<string, unknown>;
        const sequences = await tx.sequence.findMany({
          where: { trigger: e.kind, active: true, archivedAt: null },
          select: { id: true, triggerValue: true },
        });
        for (const s of sequences) {
          const value =
            e.kind === 'tag_added'
              ? detail.tagId
              : e.kind === 'stage_changed'
                ? detail.stage
                : null;
          if (s.triggerValue && s.triggerValue !== value) continue;
          if (await startRun(tx, s.id, e.clientId, now)) started += 1;
        }
        await tx.clientEvent.update({ where: { id: e.id }, data: { processedAt: now } });
      },
      prisma,
    );
  }
  return started;
}

/** Worker, part 2: runs due steps, or puts "ask first" steps in the review queue. */
export async function runDueSteps(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ done: number; failed: number; waiting: number }> {
  const due = await withSystem(
    (tx) =>
      tx.sequenceStepRun.findMany({
        where: { status: 'pending', dueAt: { lte: now }, run: { status: 'active' } },
        orderBy: { dueAt: 'asc' },
        take: 200,
        select: {
          id: true,
          organizationId: true,
          step: { select: { askFirst: true } },
          run: { select: { clientId: true, sequence: { select: { createdBy: true } } } },
        },
      }),
    prisma,
  );
  const out = { done: 0, failed: 0, waiting: 0 };
  for (const sr of due) {
    await withTenant(
      sr.organizationId,
      async (tx) => {
        if (sr.step.askFirst) {
          await tx.sequenceStepRun.update({ where: { id: sr.id }, data: { status: 'waiting' } });
          await raiseFlag(tx, {
            clientId: sr.run.clientId,
            ruleKey: 'automation_approval',
            sourceType: 'client',
            sourceId: sr.id,
            dedupeKey: `automation_approval:${sr.id}`,
            evidence: { stepRunId: sr.id },
          });
          out.waiting += 1;
          return;
        }
        const actor = await actorFor(tx, sr.organizationId, sr.run.sequence.createdBy);
        if (!actor) return;
        out[await executeStepRun(tx, actor, sr.id, now)] += 1;
      },
      prisma,
    );
  }
  return out;
}

/** PRD J7: the coach approves a waiting step (it runs now) or skips it. */
export async function decideStepRun(
  tx: TenantTx,
  actor: ActorContext,
  stepRunId: unknown,
  decision: 'approve' | 'skip',
  now: Date = new Date(),
): Promise<'done' | 'failed' | 'skipped'> {
  if (typeof stepRunId !== 'string') throw new DomainError('NOT_FOUND', 'Not found.');
  const sr = await tx.sequenceStepRun.findFirst({
    where: { id: stepRunId, status: 'waiting' },
    select: { id: true, runId: true, run: { select: { clientId: true } } },
  });
  if (!sr) throw new DomainError('NOT_FOUND', 'Not found.');
  let result: 'done' | 'failed' | 'skipped';
  if (decision === 'approve') result = await executeStepRun(tx, actor, sr.id, now);
  else {
    await tx.sequenceStepRun.update({
      where: { id: sr.id },
      data: { status: 'skipped', executedAt: now },
    });
    await finishRunIfDone(tx, sr.runId, now);
    result = 'skipped';
  }
  await tx.reviewFlag.updateMany({
    where: { ruleKey: 'automation_approval', sourceId: sr.id, state: { in: ['open', 'snoozed'] } },
    data: {
      state: 'resolved',
      resolvedAt: now,
      resolvedBy: actor.userId,
      resolutionReason: decision === 'approve' ? 'Approved' : 'Skipped',
    },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'sequence_step_run',
    objectId: sr.id,
    action: decision === 'approve' ? 'automation.step_approved' : 'automation.step_skipped',
    metadata: { clientId: sr.run.clientId },
  });
  return result;
}
