import { appendAudit, type TenantTx } from '@repsy/db';
import { isManager, TRAINER_ROLES, type ActorContext, type Role } from '../authz/actor';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

/**
 * PRD A11, A12: each client has a primary coach (`clients.coach_user_id`). Coaches and assistants see "My clients" by
 * default and owners and admins see everyone; either can switch. "Mine" is the clients whose primary coach is the
 * acting user (PRD A13 adds the coaches they cover for).
 */
export type ClientScope = 'mine' | 'all';

export const defaultScope = (role: Role): ClientScope => (isManager(role) ? 'all' : 'mine');

export const parseScope = (role: Role, value: unknown): ClientScope =>
  value === 'mine' || value === 'all' ? value : defaultScope(role);

/** The primary-coach ids "mine" means for this actor; null for "all". */
export async function scopeCoachIds(
  tx: TenantTx,
  actor: ActorContext,
  scope: ClientScope,
  now: Date = new Date(),
): Promise<string[] | null> {
  if (scope === 'all') return null;
  const covering = await tx.coachCover.findMany({
    where: {
      coverUserId: actor.userId,
      startsAt: { lte: now },
      endsAt: { gt: now },
      cancelledAt: null,
    },
    select: { coachUserId: true },
  });
  return [actor.userId, ...new Set(covering.map((c) => c.coachUserId))];
}

/** Hands a client to another coach on the team. History, programs and the message thread go with them. */
export async function transferClient(
  tx: TenantTx,
  actor: ActorContext,
  clientId: unknown,
  toUserId: unknown,
  opts: { requestId?: string } = {},
): Promise<{ coachUserId: string }> {
  if (!isUuid(clientId) || !isUuid(toUserId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, coachUserId: true },
  });
  if (!client) throw new DomainError('NOT_FOUND', 'Client not found.');
  if (!isManager(actor.role) && !(actor.role === 'coach' && client.coachUserId === actor.userId)) {
    throw new DomainError(
      'FORBIDDEN',
      'Only their coach, the owner or an admin can move this client.',
    );
  }
  const target = await tx.membership.findFirst({
    where: { userId: toUserId, status: 'active', role: { in: [...TRAINER_ROLES] } },
    select: { userId: true },
  });
  if (!target) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      toUserId: ['Pick a coach on this team.'],
    });
  }
  if (client.coachUserId === toUserId) return { coachUserId: toUserId };
  await tx.client.update({ where: { id: client.id }, data: { coachUserId: toUserId } });
  // New messages reach the new coach; the thread and its history stay.
  await tx.conversationThread.updateMany({
    where: { clientId: client.id },
    data: { coachUserId: toUserId },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: client.id,
    action: 'client.transferred',
    metadata: { clientId: client.id, from: client.coachUserId, to: toUserId },
    requestId: opts.requestId,
  });
  return { coachUserId: toUserId };
}
