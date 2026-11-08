import { appendAudit, type SystemTx, type TenantTx } from '@repsy/db';
import { assertPlatformAdmin, type PlatformAdmin } from '../admin/admin';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

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
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

const db = (tx: TenantTx): LapseDb => tx as unknown as LapseDb;

/** The workspace's lapse status for the acting user. Clients see their own 90-day clock; staff see the 180-day one. */
export async function getLapseAccess(
  tx: TenantTx,
  actor: ActorContext,
  opts: { now?: Date } = {},
): Promise<LapseView> {
  assertCan(actor, 'session:read');
  const now = opts.now ?? new Date();
  const kind: LapseActorKind = actor.role === 'client' ? 'client' : 'coach';
  const row = await openLapse(tx);
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

/** The latest open (unresolved) lapse in the transaction's organization, or null. */
async function openLapse(tx: TenantTx): Promise<{ lapsedAt: Date; reason: string | null } | null> {
  return db(tx).subscriptionLapse.findFirst({
    where: { resolvedAt: null },
    orderBy: { lapsedAt: 'desc' },
    select: { lapsedAt: true, reason: true },
  });
}

/**
 * The single gate every request path calls (M12): throws FORBIDDEN when the workspace's open lapse does not allow
 * `action` for this actor (clients on the 90-day clock, staff on the 180-day one). Full access when nothing is open.
 */
export async function assertLapseAllows(
  tx: TenantTx,
  actor: ActorContext,
  action: LapseAction,
  now: Date = new Date(),
): Promise<void> {
  const row = await openLapse(tx);
  if (!row) return;
  const access = lapseAccess(actor.role === 'client' ? 'client' : 'coach', row.lapsedAt, now);
  if (enforceReadOnly(access, action)) return;
  if (action === 'write') assertWritable(access);
  throw new DomainError('FORBIDDEN', 'Access ended after the subscription lapse window.');
}

/**
 * Platform admin records a lapse for a workspace, or ends the open one (the workspace subscribed again). A lapse is
 * never set or cleared by the workspace itself, so an owner cannot lift their own read-only mode. Audited. The reason
 * is a short fixed label, never free text about a person.
 */
export async function setSubscriptionLapse(
  tx: SystemTx,
  admin: PlatformAdmin,
  input: { organizationId?: unknown; action?: unknown; reason?: unknown; lapsedAt?: unknown },
  now: Date = new Date(),
): Promise<{ organizationId: string; open: boolean }> {
  assertPlatformAdmin(admin);
  if (typeof input.organizationId !== 'string' || !isUuid(input.organizationId)) {
    throw new DomainError('NOT_FOUND', 'Not found.');
  }
  const orgId = input.organizationId;
  const org = await tx.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) throw new DomainError('NOT_FOUND', 'Not found.');
  const lapses = (tx as unknown as LapseDb).subscriptionLapse;
  if (input.action === 'resolve') {
    const { count } = await lapses.updateMany({
      where: { organizationId: orgId, resolvedAt: null },
      data: { resolvedAt: now },
    });
    await appendAudit(tx, {
      orgId,
      actorId: admin.userId,
      objectType: 'organization',
      objectId: orgId,
      action: 'lapse.resolved',
      metadata: { resolved: count },
    });
    return { organizationId: orgId, open: false };
  }
  if (input.action !== 'lapse') {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      action: ['Use lapse or resolve.'],
    });
  }
  const reason =
    typeof input.reason === 'string' ? input.reason.trim().slice(0, 120) || null : null;
  const lapsedAt =
    input.lapsedAt !== undefined && input.lapsedAt !== null && input.lapsedAt !== ''
      ? new Date(input.lapsedAt as string)
      : now;
  if (Number.isNaN(lapsedAt.getTime())) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      lapsedAt: ['Pick a valid lapse date.'],
    });
  }
  const row = await lapses.create({
    data: { organizationId: orgId, lapsedAt, reason },
    select: { id: true },
  });
  await appendAudit(tx, {
    orgId,
    actorId: admin.userId,
    objectType: 'subscription_lapse',
    objectId: row.id,
    action: 'lapse.recorded',
  });
  return { organizationId: orgId, open: true };
}
