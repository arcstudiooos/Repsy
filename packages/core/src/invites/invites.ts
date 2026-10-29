import { appendAudit, findInviteByTokenHash, withSystem } from '@kinetic/db';
import type { PrismaClient, TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { enqueueEmail } from '../outbox';
import { newInviteToken } from './token';

export const INVITE_TTL_MS = 7 * 86_400_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InviteFailure = 'INVITE_INVALID' | 'INVITE_EXPIRED' | 'INVITE_USED' | 'INVITE_REVOKED';
export type InviteClass = 'ok' | InviteFailure;
export type InviteStatus = 'none' | 'pending' | 'expired' | 'accepted';

interface InviteState {
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

const MESSAGES: Record<InviteFailure, string> = {
  INVITE_INVALID: 'This invite link is not valid.',
  INVITE_EXPIRED: 'This invite link has expired. Ask your coach to send a new one.',
  INVITE_USED: 'This invite link has already been used.',
  INVITE_REVOKED: 'This invite link is no longer active. Ask your coach for a new one.',
};

const inviteError = (code: InviteFailure) => new DomainError(code, MESSAGES[code]);

export function classifyInvite(i: InviteState | null, now: Date): InviteClass {
  if (!i) return 'INVITE_INVALID';
  if (i.revokedAt) return 'INVITE_REVOKED';
  if (i.acceptedAt) return 'INVITE_USED';
  if (i.expiresAt.getTime() <= now.getTime()) return 'INVITE_EXPIRED';
  return 'ok';
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

/** Open = neither accepted nor revoked (it may still be expired). */
const OPEN = { acceptedAt: null, revokedAt: null } as const;

/**
 * Issue (or resend) an invite: revokes any open invite for the client, creates
 * a fresh 7-day single-use one and enqueues the email carrying the plaintext
 * token (the outbox clears it after send). Only `invited` clients qualify.
 */
export async function issueInvite(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  now: Date = new Date(),
  requestId?: string,
): Promise<{ inviteId: string; expiresAt: Date }> {
  assertCan(actor, 'client:update');
  if (!UUID.test(clientId)) throw notFound();
  // A no-op UPDATE takes the client row lock, so concurrent resends serialize
  // and cannot leave two open invites.
  const touched = await tx.client.updateMany({ where: { id: clientId }, data: { updatedAt: now } });
  if (touched.count !== 1) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { email: true, status: true },
  });
  if (!client) throw notFound();
  if (client.status !== 'invited') {
    throw new DomainError('CONFLICT', 'Only clients who have not joined yet can be invited.');
  }

  await tx.clientInvite.updateMany({ where: { clientId, ...OPEN }, data: { revokedAt: now } });
  const { token, tokenHash } = newInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  // Scalar FKs only: the tenant extension injects scalar organizationId.
  const invite = await tx.clientInvite.create({
    data: { clientId, tokenHash, expiresAt, createdBy: actor.userId },
  } as Parameters<typeof tx.clientInvite.create>[0]);

  const coach = await tx.user.findFirst({ where: { id: actor.userId }, select: { name: true } });
  const org = await tx.organization.findFirst({
    where: { id: actor.orgId },
    select: { name: true },
  });
  await enqueueEmail(tx, {
    kind: 'client_invite',
    toEmail: client.email,
    templateKey: 'client_invite',
    payload: { token, coachName: coach?.name ?? 'Your coach', orgName: org?.name ?? '' },
    idempotencyKey: `client_invite:${invite.id}`,
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: clientId,
    action: 'invite.issued',
    metadata: { inviteId: invite.id },
    requestId,
  });
  return { inviteId: invite.id, expiresAt };
}

export async function revokeInvite(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  requestId?: string,
  now: Date = new Date(),
): Promise<{ revoked: number }> {
  assertCan(actor, 'client:update');
  if (!UUID.test(clientId)) throw notFound();
  if (!(await tx.client.findFirst({ where: { id: clientId }, select: { id: true } }))) {
    throw notFound();
  }
  const { count } = await tx.clientInvite.updateMany({
    where: { clientId, ...OPEN },
    data: { revokedAt: now },
  });
  if (count > 0) {
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'client',
      objectId: clientId,
      action: 'invite.revoked',
      metadata: { count },
      requestId,
    });
  }
  return { revoked: count };
}

/** Derives the coach-facing invite state from a client's invite rows. */
export function summarizeInvites(
  rows: (InviteState & { createdAt: Date })[],
  now: Date,
): InviteStatus {
  if (rows.some((r) => r.acceptedAt)) return 'accepted';
  const latest = rows
    .filter((r) => !r.revokedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latest) return 'none';
  return latest.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending';
}

export interface AcceptInviteInput {
  tokenHash: string;
  userId: string;
  consentVersion: string;
  timezone: string;
  preferredUnits: 'kg' | 'lb';
  goals?: string;
}

/**
 * SYSTEM CODE (the invitee has no membership yet). One transaction: atomically
 * claim the invite, link the user to the client, activate it, and upsert the
 * `client` membership. Concurrent accepts: exactly one claims; the rest get
 * the re-classified error (INVITE_USED).
 */
export async function acceptInvite(
  input: AcceptInviteInput,
  now: Date = new Date(),
  prisma?: PrismaClient,
): Promise<{ orgId: string; clientId: string }> {
  const lookup = await findInviteByTokenHash(input.tokenHash, prisma);
  const pre = classifyInvite(lookup, now);
  if (pre !== 'ok' || !lookup) throw inviteError(pre === 'ok' ? 'INVITE_INVALID' : pre);

  return withSystem(async (tx) => {
    const claim = await tx.clientInvite.updateMany({
      where: { id: lookup.inviteId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (claim.count !== 1) {
      const fresh = await tx.clientInvite.findUnique({ where: { id: lookup.inviteId } });
      const code = classifyInvite(fresh, now);
      throw inviteError(code === 'ok' ? 'INVITE_USED' : code);
    }
    const linked = await tx.client.updateMany({
      where: { id: lookup.clientId, organizationId: lookup.orgId, status: 'invited' },
      data: {
        userId: input.userId,
        status: 'active',
        consentVersion: input.consentVersion,
        consentAt: now,
        timezone: input.timezone,
        preferredUnits: input.preferredUnits,
        ...(input.goals !== undefined ? { goals: input.goals } : {}),
      },
    });
    if (linked.count !== 1) throw inviteError('INVITE_INVALID');
    await tx.membership.upsert({
      where: {
        userId_organizationId_role: {
          userId: input.userId,
          organizationId: lookup.orgId,
          role: 'client',
        },
      },
      create: { userId: input.userId, organizationId: lookup.orgId, role: 'client' },
      update: { status: 'active' },
    });
    await appendAudit(tx, {
      orgId: lookup.orgId,
      actorId: input.userId,
      objectType: 'client',
      objectId: lookup.clientId,
      action: 'invite.accepted',
      metadata: { inviteId: lookup.inviteId },
    });
    return { orgId: lookup.orgId, clientId: lookup.clientId };
  }, prisma);
}
