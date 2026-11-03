import { appendAudit, withSystem, type PrismaClient, type SystemTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';

/**
 * PRD M12 (D-013 #16): access after a workspace lapses. It lapses when a platform admin marks it lapsed or its
 * trial ends without conversion. From then on it is read-only: every write is refused (`WORKSPACE_LAPSED`) except
 * the few that let people leave cleanly (exports, deletion requests, cancelling a payment plan, signing out).
 * Clients keep read access for 90 days and staff for 180; after that only an export already prepared can be
 * downloaded. The worker does nothing for a lapsed workspace. Restoring it lifts all of this at once.
 */
export const CLIENT_READ_DAYS = 90;
export const STAFF_READ_DAYS = 180;
const DAY = 86_400_000;

export interface LapseState {
  lapsed: boolean;
  since: string | null;
  /** Until when this kind of member can still read (null while active). */
  clientReadUntil: string | null;
  staffReadUntil: string | null;
}

type OrgLapseFields = { lapsedAt: Date | null; plan: string; trialEndsAt: Date | null };

/** When the workspace lapsed, or null: an admin's mark, or the end of an unconverted trial, whichever came first. */
export function lapsedSince(org: OrgLapseFields, now: Date = new Date()): Date | null {
  const trialEnd =
    org.plan === 'trial' && org.trialEndsAt && org.trialEndsAt <= now ? org.trialEndsAt : null;
  if (org.lapsedAt && trialEnd) return org.lapsedAt < trialEnd ? org.lapsedAt : trialEnd;
  return org.lapsedAt ?? trialEnd;
}

export function lapseState(org: OrgLapseFields, now: Date = new Date()): LapseState {
  const since = lapsedSince(org, now);
  return {
    lapsed: since !== null,
    since: since?.toISOString() ?? null,
    clientReadUntil: since
      ? new Date(since.getTime() + CLIENT_READ_DAYS * DAY).toISOString()
      : null,
    staffReadUntil: since ? new Date(since.getTime() + STAFF_READ_DAYS * DAY).toISOString() : null,
  };
}

/** A Prisma `where` on organizations: those still active (for worker sweeps). */
export const activeOrgWhere = (now: Date = new Date()) => ({
  lapsedAt: null,
  OR: [{ plan: { not: 'trial' } }, { trialEndsAt: null }, { trialEndsAt: { gt: now } }],
});

const lapsedError = (message: string) => new DomainError('WORKSPACE_LAPSED', message);

/**
 * The request gate (apiHandler and server actions). `write` is any change; `exempt` marks the routes a lapsed
 * workspace still allows. Reads pass until the actor's window closes.
 */
export async function assertWorkspaceAccess(
  prisma: PrismaClient,
  actor: ActorContext,
  opts: { write: boolean; exempt?: boolean; now?: Date },
): Promise<void> {
  if (actor.isPlatformAdmin) return;
  const now = opts.now ?? new Date();
  const org = await orgLapseFields(prisma, actor.orgId);
  if (!org) return;
  const since = lapsedSince(org, now);
  if (!since || opts.exempt) return;
  if (opts.write) {
    throw lapsedError(
      'This workspace is read-only because its subscription has lapsed. You can still export your data.',
    );
  }
  const days = actor.role === 'client' ? CLIENT_READ_DAYS : STAFF_READ_DAYS;
  if (now.getTime() > since.getTime() + days * DAY) {
    throw lapsedError(
      'This workspace has closed. Download an export you already prepared, or contact support.',
    );
  }
}

// A short cache: the gate runs on every request, the answer changes rarely.
const cache = new Map<string, { org: OrgLapseFields | null; until: number }>();
async function orgLapseFields(prisma: PrismaClient, orgId: string): Promise<OrgLapseFields | null> {
  const now = Date.now();
  const hit = cache.get(orgId);
  if (hit && hit.until > now) return hit.org;
  const org = await withSystem(
    (tx) =>
      tx.organization.findUnique({
        where: { id: orgId },
        select: { lapsedAt: true, plan: true, trialEndsAt: true },
      }),
    prisma,
  );
  if (cache.size > 5000) cache.clear();
  cache.set(orgId, { org, until: now + 15_000 });
  return org;
}
/** For tests and after an admin changes the state in this process. */
export const clearLapseCache = (orgId?: string) => (orgId ? cache.delete(orgId) : cache.clear());

/** Platform admin: mark a workspace lapsed, or restore it (which also converts an ended trial to the pilot plan). */
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
  if (!lapsed) {
    await tx.organization.updateMany({
      where: { id: orgId, plan: 'trial', trialEndsAt: { lte: now } },
      data: { plan: 'pilot', trialEndsAt: null },
    });
  }
  if (count === 0) throw new DomainError('NOT_FOUND', 'Not found.');
  await appendAudit(tx, {
    orgId,
    actorId: admin.userId,
    objectType: 'organization',
    objectId: orgId,
    action: lapsed ? 'organization.lapsed' : 'organization.restored',
  });
  clearLapseCache(orgId);
}
