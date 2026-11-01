import { appendAudit, type Prisma, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { localTimeOn } from '../schedule/scheduleSlots';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';
import { raiseFlag, RULE_TEXT, type RuleKey } from './rules';

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD (2026-02-31 is not): a bad one is a 422, not a 500 (PR #2 review B M-3). */
const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
export const REASON_MAX = 500;
export const FOLLOWUP_TITLE_MAX = 200;
export const FLAG_LIST_MAX = 200;
/** D-008 #11: snooze for 1 day, 3 days, 1 week or a custom date. */
export const SNOOZE_DAYS = [1, 3, 7] as const;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export type FlagState = 'open' | 'snoozed' | 'resolved' | 'dismissed';
/** Queue filters: "needs_attention" = open (snoozed ones come back by themselves). */
export type FlagFilter = 'needs_attention' | 'snoozed' | 'closed';

export interface FlagView {
  id: string;
  clientId: string;
  clientName: string;
  ruleKey: RuleKey;
  ruleText: string;
  severity: 'needs_review';
  state: FlagState;
  /** Where the coach acts on it (session, check-ins tab, conversation, client page). */
  href: string;
  /** A follow-up's title; null for rule-raised flags. */
  title: string | null;
  /** Local dates the evidence cites (sessions, check-in period). */
  dates: string[];
  sourceDueAt: string | null;
  createdAt: string;
  snoozedUntil: string | null;
  reopenedAt: string | null;
  resolvedAt: string | null;
  resolutionReason: string | null;
}

type FlagRow = Prisma.ReviewFlagGetPayload<{ include: { client: { select: { name: true } } } }>;

function hrefOf(row: FlagRow): string {
  const ev = (row.evidenceJson ?? {}) as Record<string, unknown>;
  const base = `/app/clients/${row.clientId}`;
  switch (row.ruleKey) {
    case 'missed_workouts':
      return `${base}/sessions`;
    case 'checkin_overdue':
    case 'checkin_new':
      return `${base}/check-ins`;
    case 'habit_low':
      return `${base}/habits`;
    case 'program_ending':
      return `${base}/program`;
    case 'weight_change':
      return `${base}/progress`;
    case 'nutrition_low':
      return `${base}/nutrition`;
    case 'engagement_drop':
      return base;
    case 'workout_moved':
      return `${base}/calendar`;
    case 'message_unread':
    case 'reply_overdue':
      return typeof ev.threadId === 'string'
        ? `/app/messages?thread=${ev.threadId}`
        : `${base}/messages`;
    default:
      return base;
  }
}

function toView(row: FlagRow): FlagView {
  const ev = (row.evidenceJson ?? {}) as Record<string, unknown>;
  const dates = Array.isArray(ev.dates)
    ? (ev.dates as unknown[]).filter((d): d is string => typeof d === 'string')
    : typeof ev.periodLocalDate === 'string'
      ? [ev.periodLocalDate]
      : typeof ev.dueLocalDate === 'string'
        ? [ev.dueLocalDate]
        : [];
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    ruleKey: row.ruleKey,
    ruleText: RULE_TEXT[row.ruleKey],
    severity: 'needs_review',
    state: row.state,
    href: hrefOf(row),
    title: typeof ev.title === 'string' ? ev.title : null,
    dates,
    sourceDueAt: row.sourceDueAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionReason: row.resolutionReason,
  };
}

const STATES: Record<FlagFilter, FlagState[]> = {
  needs_attention: ['open'],
  snoozed: ['snoozed'],
  closed: ['resolved', 'dismissed'],
};

const RULES = Object.keys(RULE_TEXT) as RuleKey[];
const LIVE_CLIENT = { client: { is: { status: { not: 'archived' as const } } } };

/** The review queue (S4-3): oldest source first within needs-attention, newest first for closed. */
export async function listFlags(
  tx: TenantTx,
  actor: ActorContext,
  query: { filter?: FlagFilter; rule?: string; clientId?: string } = {},
): Promise<FlagView[]> {
  assertCan(actor, 'review:read');
  const filter = query.filter ?? 'needs_attention';
  if (!(filter in STATES)) throw invalid('filter', 'Unknown filter.');
  if (query.rule !== undefined && !RULES.includes(query.rule as RuleKey)) {
    throw invalid('rule', 'Unknown rule.');
  }
  if (query.clientId !== undefined && !isUuid(query.clientId)) throw notFound();
  const rows = await tx.reviewFlag.findMany({
    where: {
      state: { in: STATES[filter] },
      // An archived client's flags leave the working queue (PR #2 review B M-12); the closed list keeps history.
      ...(filter === 'closed' ? {} : LIVE_CLIENT),
      ...(query.rule ? { ruleKey: query.rule as RuleKey } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
    },
    orderBy:
      filter === 'closed'
        ? [{ resolvedAt: 'desc' }, { id: 'desc' }]
        : [{ sourceDueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }],
    take: FLAG_LIST_MAX,
    include: { client: { select: { name: true } } },
  });
  return rows.map(toView);
}

/** Open flags per rule, for the dashboard. */
export async function countOpenFlags(
  tx: TenantTx,
  actor: ActorContext,
): Promise<{ total: number; byRule: Record<RuleKey, number> }> {
  assertCan(actor, 'review:read');
  const rows = await tx.reviewFlag.groupBy({
    by: ['ruleKey'],
    where: { state: 'open', ...LIVE_CLIENT },
    _count: { _all: true },
  });
  const byRule = Object.fromEntries(RULES.map((r) => [r, 0])) as Record<RuleKey, number>;
  for (const r of rows) byRule[r.ruleKey] = r._count._all;
  return { total: rows.reduce((n, r) => n + r._count._all, 0), byRule };
}

/** Sessions that became `missed` with a due time in the last 7 days, for the dashboard. */
export async function countRecentMissed(
  tx: TenantTx,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<number> {
  assertCan(actor, 'review:read');
  return tx.workoutSession.count({
    where: { state: 'missed', dueAt: { gte: new Date(now.getTime() - 7 * DAY_MS), lte: now } },
  });
}

export type FlagAction =
  | { action: 'resolve'; reason: unknown }
  | { action: 'dismiss'; reason: unknown }
  | { action: 'snooze'; days?: unknown; until?: unknown }
  | { action: 'reopen' };

function cleanReason(reason: unknown): string {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < 1) throw invalid('reason', 'Add a reason.');
  if (r.length > REASON_MAX) throw invalid('reason', `Use at most ${REASON_MAX} characters.`);
  return r;
}

/**
 * Coach actions on a flag (S4-3, D-008 #11): resolve or dismiss with a required reason, snooze for 1/3/7 days or
 * until a custom date (the source's due date is unchanged), or reopen. Every action is audited without the reason
 * text. Acting on a closed flag (other than reopen) is a CONFLICT.
 */
export async function updateFlag(
  tx: TenantTx,
  actor: ActorContext,
  flagId: string,
  input: FlagAction,
  opts: { now?: Date; requestId?: string } = {},
): Promise<FlagView> {
  assertCan(actor, 'review:update');
  if (!isUuid(flagId)) throw notFound();
  const now = opts.now ?? new Date();
  // Row lock, so two coaches' actions on one flag serialize.
  const locked = await tx.reviewFlag.updateMany({
    where: { id: flagId },
    data: { updatedAt: now },
  });
  if (locked.count === 0) throw notFound();
  const flag = await tx.reviewFlag.findFirstOrThrow({ where: { id: flagId } });
  const closed = flag.state === 'resolved' || flag.state === 'dismissed';

  let data: Prisma.ReviewFlagUpdateInput;
  let action: string;
  switch (input.action) {
    case 'resolve':
    case 'dismiss': {
      if (closed) throw new DomainError('CONFLICT', 'This item is already closed.');
      data = {
        state: input.action === 'resolve' ? 'resolved' : 'dismissed',
        resolutionReason: cleanReason(input.reason),
        resolvedAt: now,
        resolver: { connect: { id: actor.userId } },
        snoozedUntil: null,
      };
      action = input.action === 'resolve' ? 'review_flag.resolved' : 'review_flag.dismissed';
      break;
    }
    case 'snooze': {
      if (closed) throw new DomainError('CONFLICT', 'This item is already closed.');
      let until: Date;
      if (input.until !== undefined) {
        const date = input.until;
        if (!isDate(date)) throw invalid('until', 'Use YYYY-MM-DD.');
        const org = await tx.organization.findFirst({ select: { timezone: true } });
        const zone = org?.timezone ?? 'UTC';
        if (date <= todayInZone(zone, now)) throw invalid('until', 'Pick a date after today.');
        // Back at the start of that day, in the organization's zone.
        until = localTimeOn(date, 0, 0, zone);
      } else {
        const days = input.days;
        if (!SNOOZE_DAYS.includes(days as (typeof SNOOZE_DAYS)[number])) {
          throw invalid('days', 'Snooze for 1, 3 or 7 days, or pick a date.');
        }
        until = new Date(now.getTime() + (days as number) * DAY_MS);
      }
      data = { state: 'snoozed', snoozedUntil: until };
      action = 'review_flag.snoozed';
      break;
    }
    case 'reopen': {
      if (flag.state === 'open') return toView(await reload(tx, flagId));
      data = {
        state: 'open',
        snoozedUntil: null,
        resolvedAt: null,
        resolver: { disconnect: true },
        resolutionReason: null,
        reopenedAt: now,
      };
      action = 'review_flag.reopened';
      break;
    }
    default:
      throw invalid('action', 'Unknown action.');
  }
  await tx.reviewFlag.update({ where: { id: flagId }, data });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'review_flag',
    objectId: flagId,
    action,
    // Content-free: ids and the rule, never the reason text.
    metadata: { ruleKey: flag.ruleKey, clientId: flag.clientId },
    requestId: opts.requestId,
  });
  return toView(await reload(tx, flagId));
}

const reload = (tx: TenantTx, id: string) =>
  tx.reviewFlag.findFirstOrThrow({
    where: { id },
    include: { client: { select: { name: true } } },
  });

/** A coach's own follow-up for a client (S4-3 "Create follow-up"), queued like any flag. */
export async function createFollowup(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientId: unknown; title: unknown; dueLocalDate?: unknown },
  opts: { requestId?: string } = {},
): Promise<FlagView> {
  assertCan(actor, 'review:update');
  if (typeof input.clientId !== 'string' || !isUuid(input.clientId)) throw notFound();
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1) throw invalid('title', 'Say what to follow up on.');
  if (title.length > FOLLOWUP_TITLE_MAX) {
    throw invalid('title', `Use at most ${FOLLOWUP_TITLE_MAX} characters.`);
  }
  const client = await tx.client.findFirst({
    where: { id: input.clientId },
    select: { id: true, status: true, timezone: true },
  });
  if (!client) throw notFound();
  let dueLocalDate: string | null = null;
  if (
    input.dueLocalDate !== undefined &&
    input.dueLocalDate !== null &&
    input.dueLocalDate !== ''
  ) {
    const d = input.dueLocalDate;
    if (!isDate(d)) throw invalid('dueLocalDate', 'Use YYYY-MM-DD.');
    dueLocalDate = d;
  }
  const id = crypto.randomUUID();
  await raiseFlag(tx, {
    clientId: client.id,
    ruleKey: 'coach_followup',
    sourceType: 'followup',
    sourceId: id,
    dedupeKey: `coach_followup:${id}`,
    // The coach's own words about their own task (never client content).
    evidence: { title, ...(dueLocalDate ? { dueLocalDate } : {}) },
    sourceDueAt: dueLocalDate ? localTimeOn(dueLocalDate, 23, 59, client.timezone) : undefined,
  });
  const row = await tx.reviewFlag.findFirstOrThrow({
    where: { dedupeKey: `coach_followup:${id}` },
    include: { client: { select: { name: true } } },
  });
  await tx.reviewFlag.update({
    where: { id: row.id },
    data: { creator: { connect: { id: actor.userId } } },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'review_flag',
    objectId: row.id,
    action: 'review_flag.followup_created',
    metadata: { clientId: client.id },
    requestId: opts.requestId,
  });
  return toView(row);
}
