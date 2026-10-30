import { wantsMessageEmail, type Prisma, type TenantTx } from '@kinetic/db';
import { resolveSlotWorkoutVersionId } from '../sessions/resolve';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type RuleKey =
  'missed_workouts' | 'checkin_overdue' | 'checkin_new' | 'message_unread' | 'coach_followup';

/** The rule text shown with every flag (F10, §10). Copy is "Needs review", never "At risk". */
export const RULE_TEXT: Record<RuleKey, string> = {
  missed_workouts: 'Missed 2 or more workouts in the last 7 days',
  checkin_overdue: 'Check-in not sent by its due time',
  checkin_new: 'New check-in sent',
  message_unread: 'Client message unread for more than 24 hours',
  coach_followup: 'Follow-up you created',
};

export const AUTO_RESOLVED = 'Resolved automatically';

export interface FlagUpsert {
  clientId: string;
  ruleKey: RuleKey;
  sourceType: 'session' | 'checkin' | 'message' | 'followup';
  sourceId: string | null;
  dedupeKey: string;
  /** Rule text, dates and source ids only: never names, answers or message bodies. */
  evidence: Record<string, Prisma.InputJsonValue>;
  sourceDueAt?: Date;
}

export interface Rule {
  key: RuleKey;
  evaluate(tx: TenantTx, orgId: string, now: Date): Promise<FlagUpsert[]>;
}

const OPEN: ('open' | 'snoozed')[] = ['open', 'snoozed'];

/** Creates the flag unless its dedupe key exists (whatever its state). Returns whether it was created. */
export async function raiseFlag(tx: TenantTx, f: FlagUpsert): Promise<boolean> {
  const { count } = await tx.reviewFlag.createMany({
    data: [
      {
        clientId: f.clientId,
        ruleKey: f.ruleKey,
        sourceType: f.sourceType,
        sourceId: f.sourceId,
        dedupeKey: f.dedupeKey,
        evidenceJson: { rule: RULE_TEXT[f.ruleKey], ...f.evidence },
        sourceDueAt: f.sourceDueAt ?? null,
        // organizationId is injected by the tenant-scoped client.
      } as unknown as Prisma.ReviewFlagCreateManyInput,
    ],
    skipDuplicates: true,
  });
  return count === 1;
}

/** Resolves open or snoozed flags matching `where` with no resolver ("Resolved automatically"). */
async function autoResolve(
  tx: TenantTx,
  where: Prisma.ReviewFlagWhereInput,
  now: Date,
): Promise<number> {
  const { count } = await tx.reviewFlag.updateMany({
    where: { ...where, state: { in: OPEN } },
    data: {
      state: 'resolved',
      resolvedAt: now,
      resolvedBy: null,
      resolutionReason: AUTO_RESOLVED,
      snoozedUntil: null,
    },
  });
  return count;
}

const graceMs = async (tx: TenantTx): Promise<number> => {
  const org = await tx.organization.findFirst({ select: { graceHours: true } });
  return (org?.graceHours ?? 24) * HOUR_MS;
};

/**
 * Derived session states (D-008 #4, Ruling 4): past `dueAt + graceHours`, an unstarted session becomes `missed`
 * (locked to its slot's version now, so its history never follows later commits) and a started one `incomplete`
 * (its version is already locked). Archived clients' sessions are left alone. Idempotent.
 */
export async function deriveSessionStates(
  tx: TenantTx,
  now: Date,
): Promise<{ missed: number; incomplete: number }> {
  const cutoff = new Date(now.getTime() - (await graceMs(tx)));
  const live = { client: { is: { status: { not: 'archived' as const } } } };
  const due = await tx.workoutSession.findMany({
    where: { state: 'scheduled', dueAt: { lt: cutoff }, ...live },
    select: {
      id: true,
      assignmentId: true,
      slotWeekIndex: true,
      slotDayIndex: true,
      workoutVersionId: true,
    },
  });
  let missed = 0;
  for (const s of due) {
    let workoutVersionId = s.workoutVersionId;
    if (!workoutVersionId) {
      try {
        workoutVersionId = await resolveSlotWorkoutVersionId(tx, s);
      } catch {
        // A slot that no longer exists: the session is cancelled by the commit that removed it.
        continue;
      }
    }
    const { count } = await tx.workoutSession.updateMany({
      where: { id: s.id, state: 'scheduled' },
      data: { state: 'missed', workoutVersionId },
    });
    missed += count;
  }
  const { count: incomplete } = await tx.workoutSession.updateMany({
    where: { state: 'in_progress', dueAt: { lt: cutoff }, ...live },
    data: { state: 'incomplete' },
  });
  return { missed, incomplete };
}

/** Rule 1: two or more `missed` sessions due in the rolling 7 days (D-008 #4: only missed counts). */
export const missedWorkoutsRule: Rule = {
  key: 'missed_workouts',
  async evaluate(tx, _orgId, now) {
    const rows = await tx.workoutSession.findMany({
      where: {
        state: 'missed',
        dueAt: { gt: new Date(now.getTime() - 7 * DAY_MS), lte: now },
        // A paused client raises nothing (D-003: the paused period never counts against them).
        client: { is: { status: 'active' } },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: { id: true, clientId: true, dueAt: true, scheduledLocalDate: true },
    });
    const byClient = new Map<string, typeof rows>();
    for (const r of rows) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);
    const out: FlagUpsert[] = [];
    for (const [clientId, sessions] of byClient) {
      if (sessions.length < 2) continue;
      // One open episode per client: while a flag is open or snoozed, no second one.
      const open = await tx.reviewFlag.findFirst({
        where: { clientId, ruleKey: 'missed_workouts', state: { in: OPEN } },
        select: { id: true },
      });
      if (open) continue;
      const [a, b] = sessions as [(typeof rows)[number], (typeof rows)[number]];
      out.push({
        clientId,
        ruleKey: 'missed_workouts',
        sourceType: 'session',
        sourceId: b.id,
        dedupeKey: `missed_workouts:${clientId}:${a.id}:${b.id}`,
        evidence: {
          sessionIds: sessions.map((s) => s.id),
          dates: sessions.map((s) => s.scheduledLocalDate.toISOString().slice(0, 10)),
        },
        sourceDueAt: b.dueAt,
      });
    }
    return out;
  },
};

/** Rule 2: a check-in past `dueAt + grace` and not sent. */
export const checkinOverdueRule: Rule = {
  key: 'checkin_overdue',
  async evaluate(tx, _orgId, now) {
    const cutoff = new Date(now.getTime() - (await graceMs(tx)));
    const rows = await tx.checkin.findMany({
      where: {
        submittedAt: null,
        dueAt: { lt: cutoff },
        client: { is: { status: { not: 'archived' } } },
      },
      select: { id: true, clientId: true, dueAt: true, periodLocalDate: true },
    });
    return rows.map((c) => ({
      clientId: c.clientId,
      ruleKey: 'checkin_overdue' as const,
      sourceType: 'checkin' as const,
      sourceId: c.id,
      dedupeKey: `checkin_overdue:${c.id}`,
      evidence: { checkinId: c.id, periodLocalDate: c.periodLocalDate.toISOString().slice(0, 10) },
      sourceDueAt: c.dueAt,
    }));
  },
};

/**
 * Rule 4: the oldest client message the coach hasn't read after 24 hours, only for a coach who opted in to message
 * notifications (Ruling 5).
 */
export const messageUnreadRule: Rule = {
  key: 'message_unread',
  async evaluate(tx, _orgId, now) {
    const threads = await tx.conversationThread.findMany({
      where: { client: { is: { status: { not: 'archived' } } } },
      select: { id: true, clientId: true, coachUserId: true },
    });
    const optIn = new Map<string, boolean>();
    const out: FlagUpsert[] = [];
    for (const t of threads) {
      if (!optIn.has(t.coachUserId))
        optIn.set(t.coachUserId, await wantsMessageEmail(tx, t.coachUserId));
      if (!optIn.get(t.coachUserId)) continue;
      const oldest = await tx.message.findFirst({
        where: {
          threadId: t.id,
          readAt: null,
          senderUserId: { not: t.coachUserId },
          createdAt: { lt: new Date(now.getTime() - DAY_MS) },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, createdAt: true },
      });
      if (!oldest) continue;
      out.push({
        clientId: t.clientId,
        ruleKey: 'message_unread',
        sourceType: 'message',
        sourceId: oldest.id,
        dedupeKey: `message_unread:${oldest.id}`,
        evidence: { threadId: t.id, messageId: oldest.id, sentAt: oldest.createdAt.toISOString() },
        sourceDueAt: new Date(oldest.createdAt.getTime() + DAY_MS),
      });
    }
    return out;
  },
};

export const SWEEP_RULES: Rule[] = [missedWorkoutsRule, checkinOverdueRule, messageUnreadRule];

/**
 * A missed-workouts flag whose cited sessions are no longer all `missed` (a late completion or skip) is resolved
 * automatically (S4-2). The rolling window alone never resolves a flag.
 */
export async function resolveStaleMissedFlags(
  tx: TenantTx,
  now: Date,
  clientId?: string,
): Promise<number> {
  const flags = await tx.reviewFlag.findMany({
    where: { ruleKey: 'missed_workouts', state: { in: OPEN }, ...(clientId ? { clientId } : {}) },
    select: { id: true, evidenceJson: true },
  });
  let resolved = 0;
  for (const f of flags) {
    const ids = ((f.evidenceJson as { sessionIds?: unknown }).sessionIds ?? []) as string[];
    const stillMissed = await tx.workoutSession.count({
      where: { id: { in: ids }, state: 'missed' },
    });
    if (stillMissed < 2) resolved += await autoResolve(tx, { id: f.id }, now);
  }
  return resolved;
}

/**
 * The review sweep for one organization (worker, every 10 minutes): derives missed/incomplete sessions, reopens
 * snoozes that ran out, resolves flags whose condition went away, and raises what the rules find. Idempotent.
 */
export async function evaluateRules(
  tx: TenantTx,
  orgId: string,
  now: Date,
): Promise<{ opened: number; resolved: number; reopened: number }> {
  await deriveSessionStates(tx, now);

  const { count: reopened } = await tx.reviewFlag.updateMany({
    where: { state: 'snoozed', snoozedUntil: { lte: now } },
    data: { state: 'open', snoozedUntil: null, reopenedAt: now },
  });

  let resolved = await resolveStaleMissedFlags(tx, now);
  const overdueFlags = await tx.reviewFlag.findMany({
    where: { ruleKey: 'checkin_overdue', state: { in: OPEN } },
    select: { id: true, sourceId: true },
  });
  for (const f of overdueFlags) {
    const sent = await tx.checkin.count({
      where: { id: f.sourceId ?? '', submittedAt: { not: null } },
    });
    if (sent > 0) resolved += await autoResolve(tx, { id: f.id }, now);
  }
  const unreadFlags = await tx.reviewFlag.findMany({
    where: { ruleKey: 'message_unread', state: { in: OPEN } },
    select: { id: true, sourceId: true },
  });
  for (const f of unreadFlags) {
    const read = await tx.message.count({ where: { id: f.sourceId ?? '', readAt: { not: null } } });
    if (read > 0) resolved += await autoResolve(tx, { id: f.id }, now);
  }

  let opened = 0;
  for (const rule of SWEEP_RULES) {
    for (const f of await rule.evaluate(tx, orgId, now)) {
      if (await raiseFlag(tx, f)) opened += 1;
    }
  }
  return { opened, resolved, reopened };
}

/**
 * Rules 2 and 3 in the check-in submit transaction (D-005): the overdue flag resolves and a "New check-in sent"
 * flag opens, so the queue reflects it immediately.
 */
export async function onCheckinSubmittedRules(
  tx: TenantTx,
  checkin: { id: string; clientId: string },
  now: Date,
): Promise<void> {
  await autoResolve(tx, { ruleKey: 'checkin_overdue', sourceId: checkin.id }, now);
  const row = await tx.checkin.findFirst({
    where: { id: checkin.id },
    select: { periodLocalDate: true, dueAt: true },
  });
  await raiseFlag(tx, {
    clientId: checkin.clientId,
    ruleKey: 'checkin_new',
    sourceType: 'checkin',
    sourceId: checkin.id,
    dedupeKey: `checkin_new:${checkin.id}`,
    evidence: {
      checkinId: checkin.id,
      periodLocalDate: row?.periodLocalDate.toISOString().slice(0, 10) ?? '',
      submittedAt: now.toISOString(),
    },
    sourceDueAt: row?.dueAt,
  });
}
