import { appendAudit, withSystem, withTenant, type PrismaClient, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { cleanName, createClient } from '../clients/clients';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { issueInvite } from './invites';
import { hashInviteToken, newInviteToken } from './token';

/**
 * Join links (PRD B3): a reusable workspace link for in-person sign-ups, capped and revocable. Whoever opens it gives
 * a name and email and gets the usual single-use invite email; the client is created as if their coach (the link's
 * creator) had added them, so the client limit, verification and consent all apply unchanged. Only the token's
 * sha256 is stored, so a link is shown once, when it is created.
 */
export const JOIN_LINK_MAX_USES = 200;
export const JOIN_LINK_DAYS = 30;
const DAY_MS = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export interface JoinLinkView {
  id: string;
  maxUses: number;
  uses: number;
  expiresAt: string;
  createdAt: string;
  active: boolean;
}

const view = (
  r: {
    id: string;
    maxUses: number;
    uses: number;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  },
  now: Date,
): JoinLinkView => ({
  id: r.id,
  maxUses: r.maxUses,
  uses: r.uses,
  expiresAt: r.expiresAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  active: !r.revokedAt && r.expiresAt > now && r.uses < r.maxUses,
});

/** A new link; `token` is returned only here. */
export async function createJoinLink(
  tx: TenantTx,
  actor: ActorContext,
  input: { maxUses?: unknown },
  opts: { now?: Date; requestId?: string } = {},
): Promise<JoinLinkView & { token: string }> {
  assertCan(actor, 'client:create');
  const max = input.maxUses;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > JOIN_LINK_MAX_USES) {
    throw invalid('maxUses', `Allow 1 to ${JOIN_LINK_MAX_USES} sign-ups.`);
  }
  const now = opts.now ?? new Date();
  const { token, tokenHash } = newInviteToken();
  const row = await tx.joinLink.create({
    data: {
      tokenHash,
      createdBy: actor.userId,
      maxUses: max,
      expiresAt: new Date(now.getTime() + JOIN_LINK_DAYS * DAY_MS),
    },
  } as Parameters<typeof tx.joinLink.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'join_link',
    objectId: row.id,
    action: 'join_link.created',
    metadata: { maxUses: max },
    requestId: opts.requestId,
  });
  return { ...view(row, now), token };
}

/** This workspace's links, newest first (the last 20). */
export async function listJoinLinks(
  tx: TenantTx,
  actor: ActorContext,
  opts: { now?: Date } = {},
): Promise<JoinLinkView[]> {
  assertCan(actor, 'client:create');
  const now = opts.now ?? new Date();
  const rows = await tx.joinLink.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
  return rows.map((r) => view(r, now));
}

export async function revokeJoinLink(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  opts: { now?: Date; requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'client:create');
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const now = opts.now ?? new Date();
  const res = await tx.joinLink.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (res.count === 0 && !(await tx.joinLink.findFirst({ where: { id }, select: { id: true } }))) {
    throw new DomainError('NOT_FOUND', 'Not found.');
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'join_link',
    objectId: id,
    action: 'join_link.revoked',
    requestId: opts.requestId,
  });
}

export interface JoinLinkLookup {
  orgName: string;
  usable: boolean;
}

/** For the public page: the workspace name, and whether the link still works. Null for an unknown token. */
export async function lookupJoinLink(
  token: string,
  prisma?: PrismaClient,
  now: Date = new Date(),
): Promise<JoinLinkLookup | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  return withSystem(async (tx) => {
    const row = await tx.joinLink.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      select: {
        maxUses: true,
        uses: true,
        expiresAt: true,
        revokedAt: true,
        organization: { select: { name: true } },
      },
    });
    if (!row) return null;
    return {
      orgName: row.organization.name,
      usable: !row.revokedAt && row.expiresAt > now && row.uses < row.maxUses,
    };
  }, prisma);
}

/**
 * Someone signs up through a link. `sent` also covers an email that is already a client here, so the form never
 * reveals who is on the roster (nothing is sent or counted then). `closed`: the link was revoked, expired, used up, or
 * its coach has left; `full`: the workspace is at its client limit.
 */
export async function joinWithLink(
  input: { token?: unknown; name?: unknown; email?: unknown },
  opts: { prisma?: PrismaClient; now?: Date } = {},
): Promise<'sent' | 'closed' | 'full'> {
  const now = opts.now ?? new Date();
  const name = cleanName(typeof input.name === 'string' ? input.name : '');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 254) throw invalid('email', 'Enter a valid email.');
  if (typeof input.token !== 'string') return 'closed';
  const token = input.token;
  const link = await withSystem(async (tx) => {
    const row = await tx.joinLink.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      select: { id: true, organizationId: true, createdBy: true },
    });
    if (!row) return null;
    const member = await tx.membership.findFirst({
      where: {
        userId: row.createdBy,
        organizationId: row.organizationId,
        role: { in: ['owner', 'coach'] },
        status: 'active',
      },
      select: { role: true },
    });
    return member ? { ...row, role: member.role as 'owner' | 'coach' } : null;
  }, opts.prisma);
  if (!link) return 'closed';
  const actor: ActorContext = {
    userId: link.createdBy,
    orgId: link.organizationId,
    role: link.role,
    isPlatformAdmin: false,
  };
  try {
    return await withTenant(
      link.organizationId,
      async (tx) => {
        // One use, only while the link is open; the row lock serializes concurrent sign-ups.
        const used = await tx.joinLink.updateMany({
          where: {
            id: link.id,
            revokedAt: null,
            expiresAt: { gt: now },
            uses: { lt: tx.joinLink.fields.maxUses },
          },
          data: { uses: { increment: 1 } },
        });
        if (used.count === 0) return 'closed' as const;
        const client = await createClient(tx, actor, { name, email });
        await issueInvite(tx, actor, client.id, now);
        await appendAudit(tx, {
          orgId: link.organizationId,
          actorId: null,
          objectType: 'client',
          objectId: client.id,
          action: 'client.joined_by_link',
          metadata: { joinLinkId: link.id },
        });
        return 'sent' as const;
      },
      opts.prisma,
      { userId: link.createdBy },
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === 'EMAIL_TAKEN') return 'sent';
    if (error instanceof DomainError && error.code === 'CLIENT_LIMIT_REACHED') return 'full';
    throw error;
  }
}
