import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { clientsInPauseNow } from '../clients/pause';
import { DomainError } from '../errors';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import type { FlagUpsert } from './rules';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Review rules a coach turns on in Settings (PRD I3). Every one is off until chosen. */
export const OPT_IN_RULES = [
  'habit_low',
  'program_ending',
  'reply_overdue',
  'weight_change',
] as const;
export type OptInRule = (typeof OPT_IN_RULES)[number];

export const PROGRAM_ENDING_DAYS = 7;
export const HABIT_LOW_RATIO = 0.5;
/** weight_change compares the latest weight with the earliest one 5 to 14 days before it. */
export const WEIGHT_WINDOW = { minDays: 5, maxDays: 14 } as const;
export const WEIGHT_BAND = { min: 1, max: 20 } as const;

const OPEN: ('open' | 'snoozed')[] = ['open', 'snoozed'];

const addDays = (d: string, n: number) => fromDbDate(new Date(toDbDate(d).getTime() + n * DAY_MS));
/** Monday (YYYY-MM-DD) of the ISO week containing `d`. */
function mondayOf(d: string): string {
  const dow = toDbDate(d).getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}

interface OrgRuleSettings {
  enabled: Set<OptInRule>;
  replyTargetHours: number | null;
  weightChangeBandPct: number | null;
}

async function orgSettings(tx: TenantTx): Promise<OrgRuleSettings> {
  const org = await tx.organization.findFirst({
    select: { reviewRules: true, replyTargetHours: true, weightChangeBandPct: true },
  });
  return {
    enabled: new Set(
      (org?.reviewRules ?? []).filter((r): r is OptInRule =>
        (OPT_IN_RULES as readonly string[]).includes(r),
      ),
    ),
    replyTargetHours: org?.replyTargetHours ?? null,
    weightChangeBandPct: org?.weightChangeBandPct ?? null,
  };
}

/** Clients the opt-in rules look at: not archived and not inside a pause (paused time raises nothing, D-003). */
async function watchedClients(tx: TenantTx, now: Date) {
  const inPause = await clientsInPauseNow(tx, now);
  const rows = await tx.client.findMany({
    where: { status: { in: ['active', 'invited'] } },
    select: { id: true, timezone: true, userId: true },
  });
  return rows.filter((c) => !inPause.has(c.id));
}

/** A habit done on under half its days in each of the last two full weeks (Monday-Sunday, client-local). */
async function habitLow(tx: TenantTx, now: Date): Promise<FlagUpsert[]> {
  const clients = await watchedClients(tx, now);
  if (clients.length === 0) return [];
  const zone = new Map(clients.map((c) => [c.id, c.timezone]));
  const habits = await tx.habit.findMany({
    where: { clientId: { in: [...zone.keys()] }, status: 'active', isTask: false },
    select: {
      id: true,
      clientId: true,
      daysPerWeek: true,
      targetCount: true,
      startDate: true,
      endDate: true,
    },
  });
  const out: FlagUpsert[] = [];
  for (const h of habits) {
    const today = todayInZone(zone.get(h.clientId)!, now);
    const week2 = addDays(mondayOf(today), -7);
    const week1 = addDays(week2, -7);
    // Only habits that ran for both whole weeks.
    if (fromDbDate(h.startDate) > week1) continue;
    if (h.endDate && fromDbDate(h.endDate) < addDays(week2, 6)) continue;
    const logs = await tx.habitLog.findMany({
      where: {
        habitId: h.id,
        localDate: { gte: toDbDate(week1), lte: toDbDate(addDays(week2, 6)) },
        value: { gte: h.targetCount ?? 1 },
      },
      select: { localDate: true },
    });
    const expected = h.daysPerWeek ?? 7;
    const doneIn = (mon: string) =>
      logs.filter((l) => {
        const d = fromDbDate(l.localDate);
        return d >= mon && d <= addDays(mon, 6);
      }).length;
    const ratios = [doneIn(week1) / expected, doneIn(week2) / expected];
    if (ratios.every((r) => r < HABIT_LOW_RATIO)) {
      out.push({
        clientId: h.clientId,
        ruleKey: 'habit_low',
        sourceType: 'habit',
        sourceId: h.id,
        dedupeKey: `habit_low:${h.id}:${week2}`,
        evidence: { habitId: h.id, dates: [week1, week2] },
      });
    }
  }
  return out;
}

/** The client's last open workout is within the next 7 days and nothing is planned after it. */
async function programEnding(tx: TenantTx, now: Date): Promise<FlagUpsert[]> {
  const clients = await watchedClients(tx, now);
  const out: FlagUpsert[] = [];
  for (const c of clients) {
    const today = todayInZone(c.timezone, now);
    const last = await tx.workoutSession.findFirst({
      where: {
        clientId: c.id,
        state: { in: ['scheduled', 'in_progress'] },
        scheduledLocalDate: { gte: toDbDate(today) },
      },
      orderBy: { scheduledLocalDate: 'desc' },
      select: { assignmentId: true, scheduledLocalDate: true },
    });
    if (!last) continue;
    const lastDate = fromDbDate(last.scheduledLocalDate);
    if (lastDate > addDays(today, PROGRAM_ENDING_DAYS)) continue;
    out.push({
      clientId: c.id,
      ruleKey: 'program_ending',
      sourceType: 'assignment',
      sourceId: last.assignmentId,
      dedupeKey: `program_ending:${last.assignmentId}:${lastDate}`,
      evidence: { assignmentId: last.assignmentId, dueLocalDate: lastDate },
    });
  }
  return out;
}

/**
 * The oldest client message still unread past the organization's usual reply time (PRD H16). Like Rule 4, only
 * messages newer than the one a closed flag cited count, so resolving without replying doesn't silence later ones.
 */
async function replyOverdue(tx: TenantTx, now: Date, targetHours: number): Promise<FlagUpsert[]> {
  const threads = await tx.conversationThread.findMany({
    where: { client: { is: { status: { not: 'archived' }, userId: { not: null } } } },
    select: { id: true, clientId: true, client: { select: { userId: true } } },
  });
  const targetMs = targetHours * HOUR_MS;
  const out: FlagUpsert[] = [];
  for (const t of threads) {
    const lastClosed = await tx.reviewFlag.findFirst({
      where: {
        clientId: t.clientId,
        ruleKey: 'reply_overdue',
        state: { notIn: OPEN },
        evidenceJson: { path: ['threadId'], equals: t.id },
      },
      orderBy: { sourceDueAt: 'desc' },
      select: { sourceDueAt: true },
    });
    const after = lastClosed?.sourceDueAt
      ? new Date(lastClosed.sourceDueAt.getTime() - targetMs)
      : undefined;
    const oldest = await tx.message.findFirst({
      where: {
        threadId: t.id,
        readAt: null,
        senderUserId: t.client.userId as string,
        createdAt: { lt: new Date(now.getTime() - targetMs), ...(after ? { gt: after } : {}) },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, createdAt: true },
    });
    if (!oldest) continue;
    out.push({
      clientId: t.clientId,
      ruleKey: 'reply_overdue',
      sourceType: 'message',
      sourceId: oldest.id,
      dedupeKey: `reply_overdue:${oldest.id}`,
      evidence: { threadId: t.id, messageId: oldest.id, sentAt: oldest.createdAt.toISOString() },
      sourceDueAt: new Date(oldest.createdAt.getTime() + targetMs),
    });
  }
  return out;
}

/** The latest body weight differs from the earliest one 5-14 days before it by more than the coach's band. */
async function weightChange(tx: TenantTx, now: Date, bandPct: number): Promise<FlagUpsert[]> {
  const clients = await watchedClients(tx, now);
  const out: FlagUpsert[] = [];
  for (const c of clients) {
    const latest = await tx.metricEntry.findFirst({
      where: { clientId: c.id, metric: 'weight' },
      orderBy: { measuredOn: 'desc' },
      select: { id: true, measuredOn: true, value: true },
    });
    if (!latest) continue;
    const latestDate = fromDbDate(latest.measuredOn);
    const base = await tx.metricEntry.findFirst({
      where: {
        clientId: c.id,
        metric: 'weight',
        measuredOn: {
          gte: toDbDate(addDays(latestDate, -WEIGHT_WINDOW.maxDays)),
          lte: toDbDate(addDays(latestDate, -WEIGHT_WINDOW.minDays)),
        },
      },
      orderBy: { measuredOn: 'asc' },
      select: { measuredOn: true, value: true },
    });
    if (!base) continue;
    const from = Number(base.value);
    const pct = ((Number(latest.value) - from) / from) * 100;
    if (Math.abs(pct) <= bandPct) continue;
    out.push({
      clientId: c.id,
      ruleKey: 'weight_change',
      sourceType: 'metric',
      sourceId: latest.id,
      dedupeKey: `weight_change:${latest.id}`,
      evidence: {
        dates: [fromDbDate(base.measuredOn), latestDate],
        changePct: (Math.sign(pct) * Math.round(Math.abs(pct) * 10)) / 10,
      },
    });
  }
  return out;
}

/** Flags the enabled opt-in rules find now (PRD I3). Nothing when none is on. */
export async function evaluateOptInRules(tx: TenantTx, now: Date): Promise<FlagUpsert[]> {
  const s = await orgSettings(tx);
  const out: FlagUpsert[] = [];
  if (s.enabled.has('habit_low')) out.push(...(await habitLow(tx, now)));
  if (s.enabled.has('program_ending')) out.push(...(await programEnding(tx, now)));
  if (s.enabled.has('reply_overdue') && s.replyTargetHours) {
    out.push(...(await replyOverdue(tx, now, s.replyTargetHours)));
  }
  if (s.enabled.has('weight_change') && s.weightChangeBandPct) {
    out.push(...(await weightChange(tx, now, s.weightChangeBandPct)));
  }
  return out;
}

/**
 * Flags whose condition went away resolve on their own: a read message, a program that now runs past the next
 * 7 days. Returns how many resolved.
 */
export async function staleOptInFlags(tx: TenantTx, now: Date): Promise<string[]> {
  const stale: string[] = [];
  const replies = await tx.reviewFlag.findMany({
    where: { ruleKey: 'reply_overdue', state: { in: OPEN } },
    select: { id: true, sourceId: true },
  });
  for (const f of replies) {
    const read = await tx.message.count({ where: { id: f.sourceId ?? '', readAt: { not: null } } });
    if (read > 0) stale.push(f.id);
  }
  const ending = await tx.reviewFlag.findMany({
    where: { ruleKey: 'program_ending', state: { in: OPEN } },
    select: { id: true, clientId: true, client: { select: { timezone: true } } },
  });
  for (const f of ending) {
    const horizon = addDays(todayInZone(f.client.timezone, now), PROGRAM_ENDING_DAYS);
    const later = await tx.workoutSession.count({
      where: {
        clientId: f.clientId,
        state: { in: ['scheduled', 'in_progress'] },
        scheduledLocalDate: { gt: toDbDate(horizon) },
      },
    });
    if (later > 0) stale.push(f.id);
  }
  return stale;
}

export interface ReviewRuleSettings {
  enabled: OptInRule[];
  weightChangeBandPct: number | null;
  /** reply_overdue needs the organization's usual reply time (Settings, Messaging). */
  replyTargetHours: number | null;
}

export async function getReviewRuleSettings(
  tx: TenantTx,
  actor: ActorContext,
): Promise<ReviewRuleSettings> {
  assertCan(actor, 'org:read');
  const s = await orgSettings(tx);
  return {
    enabled: OPT_IN_RULES.filter((r) => s.enabled.has(r)),
    weightChangeBandPct: s.weightChangeBandPct,
    replyTargetHours: s.replyTargetHours,
  };
}

/** Owner only, like other organization settings. */
export async function updateReviewRuleSettings(
  tx: TenantTx,
  actor: ActorContext,
  input: { enabled: unknown; weightChangeBandPct?: unknown },
): Promise<ReviewRuleSettings> {
  assertCan(actor, 'settings:org:update');
  const invalid = (field: string, message: string) =>
    new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
  if (
    !Array.isArray(input.enabled) ||
    !input.enabled.every((r) => (OPT_IN_RULES as readonly unknown[]).includes(r))
  ) {
    throw invalid('enabled', 'Choose from the listed rules.');
  }
  const enabled = OPT_IN_RULES.filter((r) => (input.enabled as unknown[]).includes(r));
  let band: number | null | undefined;
  if (input.weightChangeBandPct !== undefined) {
    const v = input.weightChangeBandPct;
    if (v === null) band = null;
    else if (
      typeof v === 'number' &&
      Number.isInteger(v) &&
      v >= WEIGHT_BAND.min &&
      v <= WEIGHT_BAND.max
    ) {
      band = v;
    } else {
      throw invalid(
        'weightChangeBandPct',
        `Use a whole number from ${WEIGHT_BAND.min} to ${WEIGHT_BAND.max}.`,
      );
    }
  }
  const current = await orgSettings(tx);
  const nextBand = band === undefined ? current.weightChangeBandPct : band;
  if (enabled.includes('weight_change') && nextBand === null) {
    throw invalid('weightChangeBandPct', 'Set a percentage to use the weight change rule.');
  }
  await tx.organization.update({
    where: { id: actor.orgId },
    data: { reviewRules: enabled, ...(band !== undefined ? { weightChangeBandPct: band } : {}) },
  });
  return { enabled, weightChangeBandPct: nextBand, replyTargetHours: current.replyTargetHours };
}
