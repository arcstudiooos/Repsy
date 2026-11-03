import { appendAudit, withTenant, type PrismaClient, type SystemTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';

/**
 * PRD M12 (D-013 #16): access after a workspace lapses. It lapses when a platform admin marks it lapsed, or 14 days
 * after its trial ends without conversion (the coach is warned meanwhile). From then on it is read-only: every
 * write is refused (`WORKSPACE_LAPSED`) except the few that let people leave cleanly. Clients keep read access for
 * 90 days and staff for 180; after that only prepared exports can be listed and downloaded, and a payment plan can
 * still be cancelled. The worker does nothing for a lapsed workspace. Restoring it lifts all of this at once.
 */
export const CLIENT_READ_DAYS = 90;
export const STAFF_READ_DAYS = 180;
/** An ended trial lapses this long after it ends; the coach is warned meanwhile (final review #1). */
export const TRIAL_GRACE_DAYS = 14;
const DAY = 86_400_000;

export interface LapseState {
  lapsed: boolean;
  since: string | null;
  /** Until when this kind of member can still read (null while active). */
  clientReadUntil: string | null;
  staffReadUntil: string | null;
  /** An ended trial not yet lapsed: when it will (for the warning banner). */
  trialLapsesAt: string | null;
}

type OrgLapseFields = { lapsedAt: Date | null; plan: string; trialEndsAt: Date | null };

/** When an unconverted trial lapses (its end plus the grace period), or null for a non-trial. */
export function trialLapsesAt(org: OrgLapseFields): Date | null {
  return org.plan === 'trial' && org.trialEndsAt
    ? new Date(org.trialEndsAt.getTime() + TRIAL_GRACE_DAYS * DAY)
    : null;
}

/** When the workspace lapsed, or null: an admin's mark, or a trial's lapse date, whichever came first. */
export function lapsedSince(org: OrgLapseFields, now: Date = new Date()): Date | null {
  const lapses = trialLapsesAt(org);
  const trial = lapses && lapses <= now ? lapses : null;
  if (org.lapsedAt && trial) return org.lapsedAt < trial ? org.lapsedAt : trial;
  return org.lapsedAt ?? trial;
}

export function lapseState(org: OrgLapseFields, now: Date = new Date()): LapseState {
  const since = lapsedSince(org, now);
  const lapses = trialLapsesAt(org);
  return {
    lapsed: since !== null,
    since: since?.toISOString() ?? null,
    clientReadUntil: since
      ? new Date(since.getTime() + CLIENT_READ_DAYS * DAY).toISOString()
      : null,
    staffReadUntil: since ? new Date(since.getTime() + STAFF_READ_DAYS * DAY).toISOString() : null,
    trialLapsesAt:
      !since && lapses && org.trialEndsAt && org.trialEndsAt <= now ? lapses.toISOString() : null,
  };
}

/** A Prisma `where` on organizations: those still active (for worker sweeps). */
export const activeOrgWhere = (now: Date = new Date()) => ({
  lapsedAt: null,
  OR: [
    { plan: { not: 'trial' } },
    { trialEndsAt: null },
    { trialEndsAt: { gt: new Date(now.getTime() - TRIAL_GRACE_DAYS * DAY) } },
  ],
});

const lapsedError = (message: string) => new DomainError('WORKSPACE_LAPSED', message);

/**
 * The request gate (apiHandler and server pages). `write` is any change. `exempt` marks what a lapsed workspace
 * still allows: `true` while the member can still read it (exports, deletion requests, support), `'always'` even
 * after that (listing and downloading prepared exports, cancelling a payment plan) (final review #2).
 */
export async function assertWorkspaceAccess(
  prisma: PrismaClient,
  actor: ActorContext,
  opts: { write: boolean; exempt?: boolean | 'always'; now?: Date },
): Promise<void> {
  if (actor.isPlatformAdmin) return;
  const now = opts.now ?? new Date();
  const org = await orgLapseFields(prisma, actor.orgId);
  if (!org) return;
  const since = lapsedSince(org, now);
  if (!since || opts.exempt === 'always') return;
  const days = actor.role === 'client' ? CLIENT_READ_DAYS : STAFF_READ_DAYS;
  if (now.getTime() > since.getTime() + days * DAY) {
    throw lapsedError(
      'This workspace has closed. You can still download an export you already prepared.',
    );
  }
  if (opts.write && !opts.exempt) {
    throw lapsedError(
      'This workspace is read-only because its subscription has lapsed. You can still export your data.',
    );
  }
}

// A short cache: the gate runs on every request, the answer changes rarely.
const cache = new Map<string, { org: OrgLapseFields | null; until: number }>();
async function orgLapseFields(prisma: PrismaClient, orgId: string): Promise<OrgLapseFields | null> {
  const now = Date.now();
  const hit = cache.get(orgId);
  if (hit && hit.until > now) return hit.org;
  // The actor's own organization, read in its tenant scope (no system read on the request path; final review #9).
  const org = await withTenant(
    orgId,
    (tx) =>
      tx.organization.findFirst({ select: { lapsedAt: true, plan: true, trialEndsAt: true } }),
    prisma,
  );
  // Evict the oldest entry rather than everything at once.
  if (cache.size >= 5000) cache.delete(cache.keys().next().value!);
  cache.set(orgId, { org, until: now + 15_000 });
  return org;
}

/**
 * Drop cached lapse states. Call it after the transaction that changed one has committed; other instances catch
 * up within 15 seconds (final review #8).
 */
export const clearLapseCache = (orgId?: string) => (orgId ? cache.delete(orgId) : cache.clear());

/**
 * Platform admin: mark a workspace lapsed, or restore it (which also converts an ended trial to the pilot plan).
 * The caller clears the lapse cache once the transaction commits.
 */
export async function setWorkspaceLapsed(
  tx: SystemTx,
  admin: { userId: string; isPlatformAdmin: boolean },
  orgId: string,
  lapsed: boolean,
  now: Date = new Date(),
): Promise<void> {
  if (!admin.isPlatformAdmin) throw new DomainError('NOT_FOUND', 'Not found.');
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const { count } = await tx.organization.updateMany({
    where: { id: orgId },
    data: lapsed ? { lapsedAt: now } : { lapsedAt: null },
  });
  if (count === 0) throw new DomainError('NOT_FOUND', 'Not found.');
  if (!lapsed) {
    await tx.organization.updateMany({
      where: { id: orgId, plan: 'trial', trialEndsAt: { lte: now } },
      data: { plan: 'pilot', trialEndsAt: null },
    });
  }
  await appendAudit(tx, {
    orgId,
    actorId: admin.userId,
    objectType: 'organization',
    objectId: orgId,
    action: lapsed ? 'organization.lapsed' : 'organization.restored',
  });
}

/** Whether a workspace is lapsed, for flows that run before there is an actor (system read by id). */
export async function orgIsLapsed(
  tx: SystemTx,
  orgId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const org = await tx.organization.findUnique({
    where: { id: orgId },
    select: { lapsedAt: true, plan: true, trialEndsAt: true },
  });
  return org ? lapsedSince(org, now) !== null : false;
}
