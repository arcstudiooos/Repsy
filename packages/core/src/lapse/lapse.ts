import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';

/**
 * PRD M12: after a coach's subscription lapses, clients keep read-only
 * access and export for 90 days and the coach for 180 days.
 *
 * The clock is the `subscription_lapses` row (migration
 * 20260101000088_scheduling_domains), not the billing subscription itself:
 * billing (K1-K9) owns subscription status, and this slice assumes it writes
 * a lapse row — or the parent wires that call — when a subscription becomes
 * `lapsed` / `past_due` past its grace (see SLICE_REPORT_SCHEDULING.md).
 * Until a lapse row exists, access is full. `lapseAccess` is pure so the
 * windows can be tested without a database; `enforceReadOnly` is the single
 * gate write paths call.
 */
export type LapseActorKind = 'client' | 'coach';
export type LapseAccess = 'full' | 'read_only' | 'expired';
export type LapseAction = 'read' | 'write' | 'export';

export const CLIENT_LAPSE_DAYS = 90;
export const COACH_LAPSE_DAYS = 180;
const DAY_MS = 86_400_000;

/** Pure: the access level for an actor at `now`, given when the subscription lapsed. */
export function lapseAccess(
  actorKind: LapseActorKind,
  lapsedAt: Date | null,
  now: Date = new Date(),
): LapseAccess {
  if (lapsedAt === null) return 'full';
  if (now < lapsedAt) return 'full';
  const windowDays = actorKind === 'client' ? CLIENT_LAPSE_DAYS : COACH_LAPSE_DAYS;
  const elapsedMs = now.getTime() - lapsedAt.getTime();
  // The window is inclusive: exactly 90 / 180 days after the lapse is still read-only.
  if (elapsedMs <= windowDays * DAY_MS) return 'read_only';
  return 'expired';
}

/** Pure: what an access level allows. Read-only keeps reads AND exports, and blocks writes only. */
export function enforceReadOnly(access: LapseAccess, action: LapseAction): boolean {
  if (access === 'full') return true;
  if (access === 'read_only') return action === 'read' || action === 'export';
  return false;
}

/** Pure gate for write paths: throws FORBIDDEN when the actor may not write. Returns the access level otherwise. */
export function assertWritable(access: LapseAccess): LapseAccess {
  if (!enforceReadOnly(access, 'write')) {
    throw new DomainError(
      'FORBIDDEN',
      access === 'expired'
        ? 'Access ended after the subscription lapse window.'
        : 'Access is read-only after the subscription lapse.',
    );
  }
  return access;
}

export interface LapseView {
  organizationId: string;
  lapsedAt: string | null;
  reason: string | null;
  access: LapseAccess;
  /** Days of read-only access left, null when access is full or expired. */
  readOnlyDaysLeft: number | null;
}

/** Structural delegate for the not-yet-generated `subscription_lapses` model. */
export interface LapseDb {
  subscriptionLapse: {
    findFirst(args: unknown): Promise<{ lapsedAt: Date; reason: string | null } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
}

const db = (tx: TenantTx): LapseDb => tx as unknown as LapseDb;

/**
 * Records a lapse. Called by billing (or the parent's lapse hook) when a
 * subscription lapses; the reason is a short fixed label, never free text
 * about a person. A second lapse row for the same org is a new lapse event
 * (the latest row wins in `getLapseAccess`).
 */
export async function recordSubscriptionLapse(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { now?: Date } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'settings:org:update');
  const now = opts.now ?? new Date();
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 120) : null;
  const lapsedAt =
    input.lapsedAt !== undefined && input.lapsedAt !== null
      ? new Date(input.lapsedAt as string)
      : now;
  if (Number.isNaN(lapsedAt.getTime())) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      lapsedAt: ['Pick a valid lapse date.'],
    });
  }
  const row = await db(tx).subscriptionLapse.create({
    data: { lapsedAt, reason },
    select: { id: true },
  });
  return { id: row.id };
}

/** The workspace's lapse status for the acting user. Clients see their own 90-day clock; staff see the 180-day one. */
export async function getLapseAccess(
  tx: TenantTx,
  actor: ActorContext,
  opts: { now?: Date } = {},
): Promise<LapseView> {
  assertCan(actor, 'session:read');
  const now = opts.now ?? new Date();
  const kind: LapseActorKind = actor.role === 'client' ? 'client' : 'coach';
  const row = await db(tx).subscriptionLapse.findFirst({
    orderBy: { lapsedAt: 'desc' },
    select: { lapsedAt: true, reason: true },
  });
  const access = lapseAccess(kind, row ? row.lapsedAt : null, now);
  const windowDays = kind === 'client' ? CLIENT_LAPSE_DAYS : COACH_LAPSE_DAYS;
  const readOnlyDaysLeft =
    access === 'read_only' && row
      ? Math.max(
          0,
          Math.ceil((row.lapsedAt.getTime() + windowDays * DAY_MS - now.getTime()) / DAY_MS),
        )
      : null;
  return {
    organizationId: actor.orgId,
    lapsedAt: row ? row.lapsedAt.toISOString() : null,
    reason: row ? row.reason : null,
    access,
    readOnlyDaysLeft,
  };
}
