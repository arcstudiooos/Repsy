import { appendAudit, type Prisma, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { startRun } from './engine';

/** PRD J1-J3, J8, J9: automations a coach builds, starts and follows. */
export const SEQUENCE_TRIGGERS = [
  'manual',
  'invite_accepted',
  'intake_submitted',
  'checkin_submitted',
  'program_finished',
  'tag_added',
  'stage_changed',
] as const;
export type SequenceTrigger = (typeof SEQUENCE_TRIGGERS)[number];
export const STEP_TYPES = [
  'message',
  'form',
  'habit',
  'tag_add',
  'tag_remove',
  'program',
  'followup',
  'course',
] as const;
export type StepType = (typeof STEP_TYPES)[number];
export const STEPS_MAX = 30;
export const SEQUENCES_MAX = 50;
/** Steps moved here are kept for the runs that used them but are no longer part of the sequence. */
export const RETIRED = 10_000;

export interface StepInput {
  dayOffset: number;
  localTime: string;
  type: StepType;
  config: Record<string, string | number>;
  askFirst: boolean;
}

export interface SequenceView {
  id: string;
  name: string;
  trigger: SequenceTrigger;
  triggerValue: string | null;
  active: boolean;
  steps: (StepInput & { id: string })[];
  activeRuns: number;
}

export interface RunHistoryItem {
  runId: string;
  sequenceName: string;
  status: string;
  startedAt: string;
  steps: {
    id: string;
    type: StepType;
    dueAt: string;
    status: 'pending' | 'waiting' | 'done' | 'failed' | 'skipped';
    executedAt: string | null;
    error: string | null;
  }[];
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanSteps(input: unknown): StepInput[] {
  if (!Array.isArray(input)) throw invalid('steps', 'Add the steps.');
  if (input.length > STEPS_MAX) throw invalid('steps', `Use at most ${STEPS_MAX} steps.`);
  return input.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const field = `steps.${i}`;
    const type = s.type as StepType;
    if (!(STEP_TYPES as readonly unknown[]).includes(type))
      throw invalid(`${field}.type`, 'Pick what this step does.');
    const dayOffset = Number(s.dayOffset);
    if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > 365) {
      throw invalid(`${field}.dayOffset`, 'Use a day from 0 to 365.');
    }
    const localTime = typeof s.localTime === 'string' ? s.localTime : '';
    if (!TIME.test(localTime)) throw invalid(`${field}.localTime`, 'Use a time like 08:00.');
    const c = (s.config ?? {}) as Record<string, unknown>;
    const text = (k: string, max: number, message: string) => {
      const v = typeof c[k] === 'string' ? (c[k] as string).trim() : '';
      if (v.length < 1 || v.length > max) throw invalid(`${field}.config.${k}`, message);
      return v;
    };
    const id = (k: string, message: string) => {
      if (!isUuid(c[k])) throw invalid(`${field}.config.${k}`, message);
      return c[k] as string;
    };
    let config: Record<string, string | number>;
    switch (type) {
      case 'message':
        config = { body: text('body', 4000, 'Write the message.') };
        break;
      case 'form':
        config = { templateId: id('templateId', 'Pick a form.') };
        break;
      case 'habit': {
        const days = Number(c.daysPerWeek ?? 7);
        if (!Number.isInteger(days) || days < 1 || days > 7)
          throw invalid(`${field}.config.daysPerWeek`, 'Use 1-7 days.');
        config = { title: text('title', 80, 'Name the habit.'), daysPerWeek: days };
        break;
      }
      case 'tag_add':
      case 'tag_remove':
        config = { tagId: id('tagId', 'Pick a tag.') };
        break;
      case 'program':
        config = { templateProgramId: id('templateProgramId', 'Pick a program.') };
        break;
      case 'followup':
        config = { title: text('title', 200, 'Say what to follow up on.') };
        break;
      case 'course':
        config = { courseId: id('courseId', 'Pick a course.') };
        break;
    }
    return { dayOffset, localTime, type, config, askFirst: s.askFirst === true };
  });
}

const VIEW_SELECT = {
  id: true,
  name: true,
  trigger: true,
  triggerValue: true,
  active: true,
  steps: {
    // Positions from RETIRED up belong to old runs only.
    where: { position: { lt: RETIRED } },
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      dayOffset: true,
      localTime: true,
      type: true,
      configJson: true,
      askFirst: true,
    },
  },
  _count: { select: { runs: { where: { status: 'active' } } } },
};

type Row = {
  id: string;
  name: string;
  trigger: string;
  triggerValue: string | null;
  active: boolean;
  steps: {
    id: string;
    dayOffset: number;
    localTime: string;
    type: string;
    configJson: Prisma.JsonValue;
    askFirst: boolean;
  }[];
  _count: { runs: number };
};
const toView = (r: Row): SequenceView => ({
  id: r.id,
  name: r.name,
  trigger: r.trigger as SequenceTrigger,
  triggerValue: r.triggerValue,
  active: r.active,
  steps: r.steps.map((s) => ({
    id: s.id,
    dayOffset: s.dayOffset,
    localTime: s.localTime,
    type: s.type as StepType,
    config: (s.configJson ?? {}) as Record<string, string | number>,
    askFirst: s.askFirst,
  })),
  activeRuns: r._count.runs,
});

export async function listSequences(tx: TenantTx, actor: ActorContext): Promise<SequenceView[]> {
  assertCan(actor, 'client:read');
  const rows = await tx.sequence.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: 'asc' },
    select: VIEW_SELECT,
  });
  return rows.map((r) => toView(r as unknown as Row));
}

/** Creates (no `id`) or replaces a sequence and its steps. Running clients keep the steps they were given. */
export async function saveSequence(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    id?: unknown;
    name?: unknown;
    trigger?: unknown;
    triggerValue?: unknown;
    active?: unknown;
    steps?: unknown;
  },
  opts: { requestId?: string } = {},
): Promise<SequenceView> {
  assertCan(actor, 'client:update');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 120) throw invalid('name', 'Use 1-120 characters.');
  const trigger = input.trigger as SequenceTrigger;
  if (!(SEQUENCE_TRIGGERS as readonly unknown[]).includes(trigger))
    throw invalid('trigger', 'Pick what starts it.');
  const triggerValue =
    trigger === 'tag_added' || trigger === 'stage_changed'
      ? typeof input.triggerValue === 'string' &&
        input.triggerValue.length > 0 &&
        input.triggerValue.length <= 64
        ? input.triggerValue
        : null
      : null;
  if (trigger === 'tag_added' && !isUuid(triggerValue))
    throw invalid('triggerValue', 'Pick the tag.');
  const steps = cleanSteps(input.steps ?? []);
  const data = { name, trigger, triggerValue, active: input.active !== false };
  let id: string;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw new DomainError('NOT_FOUND', 'Not found.');
    const { count } = await tx.sequence.updateMany({
      where: { id: input.id, archivedAt: null },
      data,
    });
    if (count === 0) throw new DomainError('NOT_FOUND', 'Not found.');
    id = input.id;
    // Steps already given to a running client stay with that run (their step runs point at them): only steps
    // nobody has run are replaced in place; the rest are kept and new ones appended.
    await tx.sequenceStep.deleteMany({ where: { sequenceId: id, runs: { none: {} } } });
  } else {
    if ((await tx.sequence.count({ where: { archivedAt: null } })) >= SEQUENCES_MAX) {
      throw new DomainError(
        'CONFLICT',
        `A workspace can have at most ${SEQUENCES_MAX} automations.`,
      );
    }
    id = (
      await tx.sequence.create({
        data: { ...data, createdBy: actor.userId },
      } as Parameters<typeof tx.sequence.create>[0])
    ).id;
  }
  const kept = await tx.sequenceStep.findMany({ where: { sequenceId: id }, select: { id: true } });
  // A step used by a run is retired (moved past the end) rather than edited, so history stays truthful.
  for (const [i, k] of kept.entries()) {
    await tx.sequenceStep.update({ where: { id: k.id }, data: { position: RETIRED + i } });
  }
  for (const [position, s] of steps.entries()) {
    await tx.sequenceStep.create({
      data: {
        sequenceId: id,
        position,
        dayOffset: s.dayOffset,
        localTime: s.localTime,
        type: s.type,
        configJson: s.config,
        askFirst: s.askFirst,
      },
    } as Parameters<typeof tx.sequenceStep.create>[0]);
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'sequence',
    objectId: id,
    action: input.id === undefined ? 'automation.created' : 'automation.updated',
    metadata: { trigger, steps: steps.length },
    requestId: opts.requestId,
  });
  const row = await tx.sequence.findFirstOrThrow({ where: { id }, select: VIEW_SELECT });
  return toView(row as unknown as Row);
}

export async function archiveSequence(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  now: Date = new Date(),
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const { count } = await tx.sequence.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: now, active: false },
  });
  if (count === 0) throw new DomainError('NOT_FOUND', 'Not found.');
  await tx.sequenceRun.updateMany({
    where: { sequenceId: id, status: 'active' },
    data: { status: 'cancelled', endedAt: now },
  });
}

/** PRD J1: the coach starts a sequence for a client by hand. */
export async function startSequence(
  tx: TenantTx,
  actor: ActorContext,
  sequenceId: unknown,
  clientId: unknown,
  now: Date = new Date(),
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(sequenceId) || !isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const ok = await startRun(tx, sequenceId, clientId, now);
  if (!ok) throw new DomainError('CONFLICT', 'This automation is already running for this client.');
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'sequence',
    objectId: sequenceId,
    action: 'automation.started',
    metadata: { clientId },
  });
}

export async function cancelRun(
  tx: TenantTx,
  actor: ActorContext,
  runId: unknown,
  now: Date = new Date(),
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(runId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const { count } = await tx.sequenceRun.updateMany({
    where: { id: runId, status: 'active' },
    data: { status: 'cancelled', endedAt: now },
  });
  if (count === 0) throw new DomainError('NOT_FOUND', 'Not found.');
  await tx.sequenceStepRun.updateMany({
    where: { runId, status: { in: ['pending', 'waiting'] } },
    data: { status: 'skipped' },
  });
}

/** PRD J8: every automation run for a client, newest first, with each step's outcome. */
export async function runHistory(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<RunHistoryItem[]> {
  assertCan(actor, 'client:read');
  if (!isUuid(clientId)) return [];
  const runs = await tx.sequenceRun.findMany({
    where: { clientId },
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      status: true,
      startedAt: true,
      sequence: { select: { name: true } },
      steps: {
        orderBy: { dueAt: 'asc' },
        select: {
          id: true,
          dueAt: true,
          status: true,
          executedAt: true,
          error: true,
          step: { select: { type: true } },
        },
      },
    },
  });
  return runs.map((r) => ({
    runId: r.id,
    sequenceName: r.sequence.name,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    steps: r.steps.map((s) => ({
      id: s.id,
      type: s.step.type as StepType,
      dueAt: s.dueAt.toISOString(),
      status: s.status as RunHistoryItem['steps'][number]['status'],
      executedAt: s.executedAt?.toISOString() ?? null,
      error: s.error,
    })),
  }));
}

/** PRD J9: starter automations to copy and adjust. Steps that need a form, tag or program are left for the coach. */
export const SEQUENCE_TEMPLATES: {
  key: string;
  name: string;
  trigger: SequenceTrigger;
  steps: StepInput[];
}[] = [
  {
    key: 'online_onboarding',
    name: 'Online onboarding',
    trigger: 'invite_accepted',
    steps: [
      {
        dayOffset: 0,
        localTime: '09:00',
        type: 'message',
        askFirst: false,
        config: {
          body: 'Welcome aboard! Your first workouts are on the way. Reply here any time with questions.',
        },
      },
      {
        dayOffset: 2,
        localTime: '09:00',
        type: 'message',
        askFirst: false,
        config: { body: 'How did your first sessions feel? Tell me what worked and what did not.' },
      },
      {
        dayOffset: 7,
        localTime: '10:00',
        type: 'followup',
        askFirst: false,
        config: { title: 'First-week review' },
      },
    ],
  },
  {
    key: 'transformation_12',
    name: '12-week transformation',
    trigger: 'manual',
    steps: [
      {
        dayOffset: 0,
        localTime: '08:00',
        type: 'message',
        askFirst: false,
        config: { body: 'Week 1 starts today. Small steps, every day.' },
      },
      {
        dayOffset: 0,
        localTime: '08:00',
        type: 'habit',
        askFirst: false,
        config: { title: 'Walk 8,000 steps', daysPerWeek: 7 },
      },
      {
        dayOffset: 42,
        localTime: '09:00',
        type: 'followup',
        askFirst: false,
        config: { title: 'Halfway check: progress photos and measurements' },
      },
      {
        dayOffset: 84,
        localTime: '09:00',
        type: 'message',
        askFirst: true,
        config: {
          body: 'Twelve weeks done. Let us look back at how far you have come and plan what is next.',
        },
      },
    ],
  },
  {
    key: 'hybrid',
    name: 'Hybrid in-person',
    trigger: 'manual',
    steps: [
      {
        dayOffset: 0,
        localTime: '09:00',
        type: 'message',
        askFirst: false,
        config: {
          body: 'Between our sessions, your app workouts keep things moving. See you at the gym!',
        },
      },
      {
        dayOffset: 14,
        localTime: '09:00',
        type: 'followup',
        askFirst: false,
        config: { title: 'Review in-person and app sessions' },
      },
    ],
  },
  {
    key: 're_engagement',
    name: 'Re-engagement',
    trigger: 'manual',
    steps: [
      {
        dayOffset: 0,
        localTime: '10:00',
        type: 'message',
        askFirst: true,
        config: {
          body: 'Haven’t seen you in a while. What would help you get back on track this week?',
        },
      },
      {
        dayOffset: 3,
        localTime: '10:00',
        type: 'followup',
        askFirst: false,
        config: { title: 'Check in if no reply' },
      },
    ],
  },
];
