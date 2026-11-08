import { appendAudit, withSystem, type PrismaClient, type TenantTx } from '@repsy/db';
import { isCoachRole, isManager, STAFF_ROLES, type ActorContext, type Role } from '../authz/actor';
import { DomainError } from '../errors';
import { hashInviteToken, newInviteToken } from '../invites/token';
import { enqueueEmail } from '../outbox';
import { isUuid } from '../uuid';

/**
 * PRD A10, the R3 team rollout: a workspace's staff and the invites that add to it. Owners and admins invite, change
 * roles and remove people; only the owner makes or demotes admins, and the owner can't be changed here. Invites are
 * emailed links (7 days, single use) accepted by a signed-in account with the invited email.
 */
export const TEAM_ROLES = ['admin', 'coach', 'assistant'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export const TEAM_INVITE_DAYS = 7;
export const TEAM_MAX = 50;

export interface TeamMemberView {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface TeamInviteView {
  id: string;
  email: string;
  role: TeamRole;
  expiresAt: string;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const forbid = (m = 'Only the workspace owner or an admin can do this.') =>
  new DomainError('FORBIDDEN', m);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function teamRole(role: unknown): TeamRole {
  if (!(TEAM_ROLES as readonly unknown[]).includes(role))
    throw invalid('role', 'Pick admin, coach or assistant.');
  return role as TeamRole;
}

/** Owners and admins manage the team; making or changing an admin is the owner's. */
function assertMayGrant(actor: ActorContext, role: Role) {
  if (!isManager(actor.role)) throw forbid();
  if ((role === 'admin' || role === 'owner') && actor.role !== 'owner') {
    throw forbid('Only the workspace owner can make or change an admin.');
  }
}

export async function listTeam(
  tx: TenantTx,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<{ members: TeamMemberView[]; invites: TeamInviteView[] }> {
  if (!isCoachRole(actor.role)) throw forbid('You do not have access to this.');
  const rows = await tx.membership.findMany({
    where: { role: { in: [...STAFF_ROLES] }, status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      role: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
    },
  });
  const order = (r: Role) => STAFF_ROLES.indexOf(r as (typeof STAFF_ROLES)[number]);
  const members = rows
    .map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role as Role,
      joinedAt: m.createdAt.toISOString(),
    }))
    .sort((a, b) => order(a.role) - order(b.role) || a.name.localeCompare(b.name));
  const invites = isManager(actor.role)
    ? (
        await tx.teamInvite.findMany({
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, email: true, role: true, expiresAt: true },
        })
      ).map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role as TeamRole,
        expiresAt: i.expiresAt.toISOString(),
      }))
    : [];
  return { members, invites };
}

export async function inviteTeammate(
  tx: TenantTx,
  actor: ActorContext,
  input: { email?: unknown; role?: unknown },
  opts: { now?: Date; requestId?: string } = {},
): Promise<TeamInviteView> {
  const role = teamRole(input.role);
  assertMayGrant(actor, role);
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 320) throw invalid('email', 'Enter an email address.');
  const now = opts.now ?? new Date();
  const staff = await tx.membership.count({
    where: { role: { in: [...STAFF_ROLES] }, status: 'active' },
  });
  if (staff >= TEAM_MAX)
    throw new DomainError('CONFLICT', `A team can have at most ${TEAM_MAX} people.`);
  const already = await tx.membership.findFirst({
    where: { role: { in: [...STAFF_ROLES] }, status: 'active', user: { is: { email } } },
    select: { id: true },
  });
  if (already) throw new DomainError('CONFLICT', 'That person is already on the team.');
  // A new invite to the same address replaces the open one.
  await tx.teamInvite.updateMany({
    where: { email, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  const { token, tokenHash } = newInviteToken();
  const row = await tx.teamInvite.create({
    data: {
      email,
      role,
      tokenHash,
      invitedBy: actor.userId,
      expiresAt: new Date(now.getTime() + TEAM_INVITE_DAYS * 86_400_000),
    },
  } as Parameters<typeof tx.teamInvite.create>[0]);
  const [org, inviter] = await Promise.all([
    tx.organization.findFirst({ select: { name: true } }),
    tx.user.findFirst({ where: { id: actor.userId }, select: { name: true } }),
  ]);
  await enqueueEmail(tx, {
    kind: 'team_invite',
    toEmail: email,
    templateKey: 'team_invite',
    payload: { token, role, orgName: org?.name ?? '', inviterName: inviter?.name ?? '' },
    idempotencyKey: `team-invite:${row.id}`,
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'team_invite',
    objectId: row.id,
    action: 'team.invited',
    metadata: { role },
    requestId: opts.requestId,
  });
  return { id: row.id, email, role, expiresAt: row.expiresAt.toISOString() };
}

export async function revokeTeamInvite(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  opts: { now?: Date; requestId?: string } = {},
): Promise<void> {
  if (!isManager(actor.role)) throw forbid();
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.teamInvite.updateMany({
    where: { id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: opts.now ?? new Date() },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'team_invite',
    objectId: id,
    action: 'team.invite_revoked',
    requestId: opts.requestId,
  });
}

async function staffMembership(tx: TenantTx, id: unknown) {
  if (!isUuid(id)) throw notFound();
  const m = await tx.membership.findFirst({
    where: { id, role: { in: [...STAFF_ROLES] }, status: 'active' },
    select: { id: true, userId: true, role: true },
  });
  if (!m) throw notFound();
  return m;
}

export async function changeTeamRole(
  tx: TenantTx,
  actor: ActorContext,
  membershipId: unknown,
  role: unknown,
  opts: { requestId?: string } = {},
): Promise<void> {
  const next = teamRole(role);
  const m = await staffMembership(tx, membershipId);
  if (m.role === 'owner')
    throw new DomainError('CONFLICT', "The owner's role can't be changed here.");
  assertMayGrant(actor, next);
  assertMayGrant(actor, m.role as Role);
  if (m.role === next) return;
  // One membership per (user, org, role): a role change is a move of that row.
  await tx.membership.update({ where: { id: m.id }, data: { role: next } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'membership',
    objectId: m.id,
    action: 'team.role_changed',
    metadata: { from: m.role, to: next },
    requestId: opts.requestId,
  });
}

/** Removes someone from the team (their account and other workspaces are untouched). */
export async function removeTeammate(
  tx: TenantTx,
  actor: ActorContext,
  membershipId: unknown,
  opts: { requestId?: string } = {},
): Promise<void> {
  const m = await staffMembership(tx, membershipId);
  if (m.role === 'owner') throw new DomainError('CONFLICT', "The owner can't be removed.");
  assertMayGrant(actor, m.role as Role);
  if (m.userId === actor.userId) throw new DomainError('CONFLICT', "You can't remove yourself.");
  const clients = await tx.client.count({
    where: { coachUserId: m.userId, status: { not: 'archived' } },
  });
  if (clients > 0) {
    throw new DomainError(
      'CONFLICT',
      `Move their ${clients === 1 ? 'client' : `${clients} clients`} to another coach first.`,
    );
  }
  await tx.membership.update({ where: { id: m.id }, data: { status: 'inactive' } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'membership',
    objectId: m.id,
    action: 'team.removed',
    metadata: { role: m.role },
    requestId: opts.requestId,
  });
}

export interface TeamInviteLookup {
  orgName: string;
  role: TeamRole;
  email: string;
  state: 'open' | 'used' | 'expired';
}

/** System scope, by the token's hash (the token is the credential, as for a client invite). */
export async function lookupTeamInvite(
  prisma: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<TeamInviteLookup | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const row = await withSystem(
    (tx) =>
      tx.teamInvite.findFirst({
        where: { tokenHash: hashInviteToken(token) },
        select: {
          email: true,
          role: true,
          acceptedAt: true,
          revokedAt: true,
          expiresAt: true,
          organization: { select: { name: true } },
        },
      }),
    prisma,
  );
  if (!row) return null;
  return {
    orgName: row.organization.name,
    role: row.role as TeamRole,
    email: row.email,
    state: row.acceptedAt || row.revokedAt ? 'used' : row.expiresAt <= now ? 'expired' : 'open',
  };
}

/**
 * The signed-in user joins the team. Their account email must be the invited one and verified. Returns the
 * organization joined. Pre-membership, so system scope: authorized by the token alone, like `acceptInvite`.
 */
export async function acceptTeamInvite(
  prisma: PrismaClient,
  token: string,
  user: { id: string; email: string; emailVerified: boolean },
  now: Date = new Date(),
): Promise<{ orgId: string }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound();
  return withSystem(async (tx) => {
    const invite = await tx.teamInvite.findFirst({
      where: { tokenHash: hashInviteToken(token) },
    });
    if (!invite || invite.revokedAt || invite.acceptedAt) throw notFound();
    if (invite.expiresAt <= now)
      throw new DomainError('CONFLICT', 'This invite has expired. Ask for a new one.');
    if (!user.emailVerified || user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new DomainError('FORBIDDEN', `Sign in as ${invite.email} to accept this invite.`);
    }
    const existing = await tx.membership.findFirst({
      where: {
        userId: user.id,
        organizationId: invite.organizationId,
        role: { in: [...STAFF_ROLES] },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      await tx.membership.update({
        where: { id: existing.id },
        data: { status: 'active', role: invite.role as TeamRole },
      });
    } else {
      await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: invite.organizationId,
          role: invite.role as TeamRole,
        },
      });
    }
    await tx.teamInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: now, acceptedBy: user.id },
    });
    await appendAudit(tx, {
      orgId: invite.organizationId,
      actorId: user.id,
      objectType: 'team_invite',
      objectId: invite.id,
      action: 'team.joined',
      metadata: { role: invite.role },
    });
    return { orgId: invite.organizationId };
  }, prisma);
}
