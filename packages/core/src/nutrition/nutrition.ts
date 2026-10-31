import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Days of logs returned. */
export const NUTRITION_HISTORY_DAYS = 28;
/** How far back a day's totals may be logged or changed. */
export const NUTRITION_BACKFILL_DAYS = 7;
/** A logged value within this share of its target counts as on target (PRD G7: ±10% by default). */
export const NUTRITION_TOLERANCE = 0.1;

export const MACROS = ['calories', 'proteinG', 'carbsG', 'fatG'] as const;
export type Macro = (typeof MACROS)[number];
export type Macros = Record<Macro, number | null>;

const TARGET_RANGE: Record<Macro, [number, number]> = {
  calories: [500, 10_000],
  proteinG: [0, 1000],
  carbsG: [0, 2000],
  fatG: [0, 1000],
};
const LOG_RANGE: Record<Macro, [number, number]> = {
  calories: [0, 20_000],
  proteinG: [0, 2000],
  carbsG: [0, 4000],
  fatG: [0, 2000],
};

export interface NutritionDay extends Macros {
  localDate: string;
  /** Whether every targeted value logged that day is within the tolerance (null without a target or log). */
  onTarget: boolean | null;
}

export interface NutritionView {
  todayLocalDate: string;
  /** The target in effect today, null when none is set. */
  target: (Macros & { effectiveFrom: string }) | null;
  /** Logged days in the last 28, newest first. */
  days: NutritionDay[];
  /** On-target days of logged days with a target, in the last 28. */
  adherence: { onTarget: number; logged: number };
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const addDays = (d: string, n: number) => fromDbDate(new Date(toDbDate(d).getTime() + n * DAY_MS));
const isDate = (v: unknown): v is string =>
  typeof v === 'string' && DATE.test(v) && fromDbDate(toDbDate(v)) === v;

async function resolveClient(tx: TenantTx, actor: ActorContext, clientId: string) {
  if (!isUuid(clientId)) throw notFound();
  if (actor.role === 'client' && actor.clientId?.toLowerCase() !== clientId.toLowerCase()) {
    throw notFound();
  }
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, organizationId: true, timezone: true },
  });
  if (!client) throw notFound();
  let today: string;
  try {
    today = todayInZone(client.timezone);
  } catch {
    today = todayInZone('UTC');
  }
  return { ...client, today };
}

function readMacros(
  input: Record<string, unknown>,
  ranges: Record<Macro, [number, number]>,
): Macros {
  const out = {} as Macros;
  for (const m of MACROS) {
    const v = input[m];
    if (v === undefined || v === null || v === '') {
      out[m] = null;
      continue;
    }
    const [lo, hi] = ranges[m];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) {
      throw invalid(m, `Use a whole number from ${lo} to ${hi}.`);
    }
    out[m] = v;
  }
  if (MACROS.every((m) => out[m] === null)) throw invalid('calories', 'Enter at least one value.');
  return out;
}

/** Whether every value the target sets and the day logs is within the tolerance. */
export function isOnTarget(target: Macros | null, day: Macros): boolean | null {
  if (!target) return null;
  const pairs = MACROS.filter((m) => target[m] !== null && day[m] !== null);
  if (pairs.length === 0) return null;
  return pairs.every((m) => {
    const t = target[m] as number;
    const v = day[m] as number;
    return t === 0 ? v === 0 : Math.abs(v - t) / t <= NUTRITION_TOLERANCE;
  });
}

const pick = (r: Macros): Macros => ({
  calories: r.calories,
  proteinG: r.proteinG,
  carbsG: r.carbsG,
  fatG: r.fatG,
});

/** The client's nutrition: today's target, the last 28 days of totals and adherence (PRD G6/G7). */
export async function getNutrition(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<NutritionView> {
  assertCan(actor, 'nutrition:read');
  const client = await resolveClient(tx, actor, clientId);
  const since = addDays(client.today, -(NUTRITION_HISTORY_DAYS - 1));
  const targets = await tx.nutritionTarget.findMany({
    where: { clientId: client.id, effectiveFrom: { lte: toDbDate(client.today) } },
    orderBy: { effectiveFrom: 'desc' },
  });
  const logs = await tx.nutritionLog.findMany({
    where: {
      clientId: client.id,
      localDate: { gte: toDbDate(since), lte: toDbDate(client.today) },
    },
    orderBy: { localDate: 'desc' },
  });
  const targetOn = (d: string) => targets.find((t) => fromDbDate(t.effectiveFrom) <= d) ?? null;
  const days = logs.map((l) => {
    const date = fromDbDate(l.localDate);
    const t = targetOn(date);
    return { localDate: date, ...pick(l), onTarget: isOnTarget(t ? pick(t) : null, pick(l)) };
  });
  const judged = days.filter((d) => d.onTarget !== null);
  const current = targets[0];
  return {
    todayLocalDate: client.today,
    target: current ? { ...pick(current), effectiveFrom: fromDbDate(current.effectiveFrom) } : null,
    days,
    adherence: { onTarget: judged.filter((d) => d.onTarget).length, logged: judged.length },
  };
}

/** A coach sets the client's daily targets from a date on (default today); a second set for that date replaces it. */
export async function setNutritionTarget(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  input: Record<string, unknown>,
  opts: { requestId?: string } = {},
): Promise<NutritionView> {
  assertCan(actor, 'nutrition:manage');
  const client = await resolveClient(tx, actor, clientId);
  const effectiveFrom = input.effectiveFrom === undefined ? client.today : input.effectiveFrom;
  if (!isDate(effectiveFrom)) throw invalid('effectiveFrom', 'Use YYYY-MM-DD.');
  const values = readMacros(input, TARGET_RANGE);
  await tx.nutritionTarget.upsert({
    where: {
      clientId_effectiveFrom: { clientId: client.id, effectiveFrom: toDbDate(effectiveFrom) },
    },
    create: {
      organizationId: client.organizationId,
      clientId: client.id,
      effectiveFrom: toDbDate(effectiveFrom),
      ...values,
      setByUserId: actor.userId,
    },
    update: { ...values, setByUserId: actor.userId },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: client.id,
    action: 'nutrition.target_set',
    requestId: opts.requestId,
  });
  return getNutrition(tx, actor, client.id);
}

/** Logs a day's totals (today or up to 7 days back); saving again replaces that day (PRD G7). */
export async function logNutrition(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  input: Record<string, unknown>,
): Promise<NutritionView> {
  assertCan(actor, 'nutrition:log');
  const client = await resolveClient(tx, actor, clientId);
  const localDate = input.localDate === undefined ? client.today : input.localDate;
  if (!isDate(localDate)) throw invalid('localDate', 'Use YYYY-MM-DD.');
  if (localDate > client.today) throw invalid('localDate', 'Pick today or an earlier day.');
  if (localDate < addDays(client.today, -NUTRITION_BACKFILL_DAYS)) {
    throw invalid('localDate', `Pick a day in the last ${NUTRITION_BACKFILL_DAYS} days.`);
  }
  const values = readMacros(input, LOG_RANGE);
  await tx.nutritionLog.upsert({
    where: { clientId_localDate: { clientId: client.id, localDate: toDbDate(localDate) } },
    create: {
      organizationId: client.organizationId,
      clientId: client.id,
      localDate: toDbDate(localDate),
      ...values,
    },
    update: values,
  });
  return getNutrition(tx, actor, client.id);
}
