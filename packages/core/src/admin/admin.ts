import { appendAudit, type SystemTx } from '@kinetic/db';
import { DomainError } from '../errors';
import { generatePilotCode } from '../identity/pilotCode';
import { isUuid } from '../uuid';

const DAY_MS = 86_400_000;
/** D-006 roles: a support grant lasts 24 hours. */
export const SUPPORT_GRANT_MS = DAY_MS;
const REASON_MAX = 500;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export interface PlatformAdmin {
  userId: string;
  isPlatformAdmin: boolean;
}

/** The admin console is invisible to everyone else: not a 403, a 404 (S5-3). */
export function assertPlatformAdmin(user: PlatformAdmin): void {
  if (!user.isPlatformAdmin) throw notFound();
}

function cleanReason(reason: unknown): string {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < 1) throw invalid('reason', 'Add a reason.');
  if (r.length > REASON_MAX) throw invalid('reason', `Use at most ${REASON_MAX} characters.`);
  return r;
}

/** Platform-level audit rows belong to the subject's organization when there is one. */
async function audit(
  tx: SystemTx,
  orgId: string,
  admin: PlatformAdmin,
  objectType: string,
  objectId: string,
  action: string,
  metadata?: Record<string, string | number | boolean>,
) {
  await appendAudit(tx, { orgId, actorId: admin.userId, objectType, objectId, action, metadata });
}

// --- pilot codes ---------------------------------------------------------------------------------------------

export interface PilotCodeView {
  id: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
}

export async function listPilotCodes(tx: SystemTx, admin: PlatformAdmin): Promise<PilotCodeView[]> {
  assertPlatformAdmin(admin);
  const rows = await tx.pilotCode.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    used: r.usedBy !== null || r.usedAt !== null,
  }));
}

/** Creates a pilot code. The plaintext is returned once and never stored (D-008 #19). */
export async function createPilotCode(
  tx: SystemTx,
  admin: PlatformAdmin,
  input: { days?: unknown } = {},
  now: Date = new Date(),
): Promise<{ id: string; code: string; expiresAt: string }> {
  assertPlatformAdmin(admin);
  const days = input.days === undefined ? 30 : input.days;
  if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 90) {
    throw invalid('days', 'Use 1-90 days.');
  }
  const { code, codeHash } = generatePilotCode();
  const row = await tx.pilotCode.create({
    data: {
      codeHash,
      createdBy: admin.userId,
      expiresAt: new Date(now.getTime() + (days as number) * DAY_MS),
    },
  });
  return { id: row.id, code, expiresAt: row.expiresAt.toISOString() };
}

// --- accounts ------------------------------------------------------------------------------------------------

export interface AccountView {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
  createdAt: string;
  memberships: {
    organizationId: string;
    organizationName: string;
    role: string;
    status: string;
    clientId: string | null;
  }[];
}

/** Account lookup by exact email (support). Shows the account and its memberships, not client content. */
export async function lookupAccount(
  tx: SystemTx,
  admin: PlatformAdmin,
  email: unknown,
): Promise<AccountView | null> {
  assertPlatformAdmin(admin);
  if (typeof email !== 'string' || !email.includes('@')) throw invalid('email', 'Enter an email.');
  const user = await tx.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: {
      memberships: { include: { organization: { select: { name: true } } } },
      clientProfiles: { select: { id: true, organizationId: true } },
    },
  });
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    isPlatformAdmin: user.isPlatformAdmin,
    createdAt: user.createdAt.toISOString(),
    memberships: user.memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      role: m.role,
      status: m.status,
      clientId:
        m.role === 'client'
          ? (user.clientProfiles.find((c) => c.organizationId === m.organizationId)?.id ?? null)
          : null,
    })),
  };
}

// --- deletion queue ------------------------------------------------------------------------------------------

export interface DeletionQueueItem {
  id: string;
  organizationId: string;
  organizationName: string;
  clientId: string;
  status: string;
  legalHold: boolean;
  requestedByClient: boolean;
  createdAt: string;
  verifiedAt: string | null;
  completedAt: string | null;
  /** Failed erasure runs and the last error code (PR #2 review C-I1); the worker keeps retrying. */
  failedAttempts: number;
  lastErrorCode: string | null;
}

export async function listDeletionRequests(
  tx: SystemTx,
  admin: PlatformAdmin,
): Promise<DeletionQueueItem[]> {
  assertPlatformAdmin(admin);
  const rows = await tx.deletionRequest.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { organization: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    organizationName: r.organization.name,
    clientId: r.subjectClientId,
    status: r.status,
    legalHold: r.legalHold,
    requestedByClient: r.subjectUserId !== null && r.requestedBy === r.subjectUserId,
    createdAt: r.createdAt.toISOString(),
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    failedAttempts: r.attempts,
    lastErrorCode: r.lastErrorCode,
  }));
}

/**
 * Admin decisions on a deletion request: verify (the worker then runs it), reject with a reason, or set/clear a
 * legal hold. Audited without content.
 */
export async function decideDeletion(
  tx: SystemTx,
  admin: PlatformAdmin,
  requestId: string,
  input:
    { action: 'verify' } | { action: 'reject'; reason: unknown } | { action: 'hold'; on: boolean },
  now: Date = new Date(),
): Promise<void> {
  assertPlatformAdmin(admin);
  if (!isUuid(requestId)) throw notFound();
  const req = await tx.deletionRequest.findUnique({ where: { id: requestId } });
  if (!req) throw notFound();
  const open = req.status === 'requested' || req.status === 'verified';
  if (input.action === 'hold') {
    await tx.deletionRequest.update({ where: { id: req.id }, data: { legalHold: input.on } });
  } else if (!open) {
    throw new DomainError('CONFLICT', 'This request is already being processed or closed.');
  } else if (input.action === 'verify') {
    await tx.deletionRequest.update({
      where: { id: req.id },
      data: { status: 'verified', verifiedBy: admin.userId, verifiedAt: now },
    });
  } else {
    await tx.deletionRequest.update({
      where: { id: req.id },
      data: { status: 'rejected', rejectedReason: cleanReason(input.reason) },
    });
  }
  const action =
    input.action === 'hold'
      ? input.on
        ? 'deletion.hold_set'
        : 'deletion.hold_cleared'
      : input.action === 'verify'
        ? 'deletion.verified'
        : 'deletion.rejected';
  await audit(tx, req.organizationId, admin, 'deletion_request', req.id, action);
}

// --- support access ------------------------------------------------------------------------------------------

export interface SupportGrantView {
  id: string;
  clientId: string;
  organizationId: string;
  expiresAt: string;
  active: boolean;
}

/** An explicit, audited grant for one client, with a reason, for 24 hours (D-006 roles). */
export async function grantSupportAccess(
  tx: SystemTx,
  admin: PlatformAdmin,
  input: { clientId: unknown; reason: unknown },
  now: Date = new Date(),
): Promise<SupportGrantView> {
  assertPlatformAdmin(admin);
  if (typeof input.clientId !== 'string' || !isUuid(input.clientId)) throw notFound();
  const reason = cleanReason(input.reason);
  const client = await tx.client.findUnique({
    where: { id: input.clientId },
    select: { id: true, organizationId: true },
  });
  if (!client) throw notFound();
  const row = await tx.supportAccessGrant.create({
    data: {
      organizationId: client.organizationId,
      adminUserId: admin.userId,
      clientId: client.id,
      reason,
      expiresAt: new Date(now.getTime() + SUPPORT_GRANT_MS),
    },
  });
  await audit(tx, client.organizationId, admin, 'support_grant', row.id, 'support.granted', {
    clientId: client.id,
  });
  return {
    id: row.id,
    clientId: row.clientId,
    organizationId: row.organizationId,
    expiresAt: row.expiresAt.toISOString(),
    active: true,
  };
}

export async function revokeSupportAccess(
  tx: SystemTx,
  admin: PlatformAdmin,
  grantId: string,
  now: Date = new Date(),
): Promise<void> {
  assertPlatformAdmin(admin);
  if (!isUuid(grantId)) throw notFound();
  const g = await tx.supportAccessGrant.findFirst({
    where: { id: grantId, adminUserId: admin.userId },
  });
  if (!g) throw notFound();
  await tx.supportAccessGrant.update({ where: { id: g.id }, data: { revokedAt: now } });
  await audit(tx, g.organizationId, admin, 'support_grant', g.id, 'support.revoked', {
    clientId: g.clientId,
  });
}

export async function listMyGrants(
  tx: SystemTx,
  admin: PlatformAdmin,
  now: Date = new Date(),
): Promise<SupportGrantView[]> {
  assertPlatformAdmin(admin);
  const rows = await tx.supportAccessGrant.findMany({
    where: { adminUserId: admin.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map((g) => ({
    id: g.id,
    clientId: g.clientId,
    organizationId: g.organizationId,
    expiresAt: g.expiresAt.toISOString(),
    active: !g.revokedAt && g.expiresAt > now,
  }));
}

export interface SupportClientView {
  clientId: string;
  name: string;
  email: string;
  status: string;
  timezone: string;
  sessions: { scheduled: number; completed: number; missed: number };
  checkins: { issued: number; submitted: number };
}

/**
 * A client's data for support (S5-3): only with this admin's unexpired, unrevoked grant (else FORBIDDEN). Every
 * read is audited.
 */
export async function readClientForSupport(
  tx: SystemTx,
  admin: PlatformAdmin,
  clientId: string,
  now: Date = new Date(),
): Promise<SupportClientView> {
  assertPlatformAdmin(admin);
  if (!isUuid(clientId)) throw notFound();
  const grant = await tx.supportAccessGrant.findFirst({
    where: { adminUserId: admin.userId, clientId, revokedAt: null, expiresAt: { gt: now } },
  });
  if (!grant) {
    throw new DomainError('FORBIDDEN', 'You need an active support access grant for this client.');
  }
  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
  const count = (state: 'scheduled' | 'completed' | 'missed') =>
    tx.workoutSession.count({ where: { clientId, state } });
  const view: SupportClientView = {
    clientId,
    name: client.name,
    email: client.email,
    status: client.status,
    timezone: client.timezone,
    sessions: {
      scheduled: await count('scheduled'),
      completed: await count('completed'),
      missed: await count('missed'),
    },
    checkins: {
      issued: await tx.checkin.count({ where: { clientId } }),
      submitted: await tx.checkin.count({ where: { clientId, submittedAt: { not: null } } }),
    },
  };
  await audit(tx, client.organizationId, admin, 'client', clientId, 'support.client_read', {
    grantId: grant.id,
  });
  return view;
}
