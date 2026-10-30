import { appendAudit, type SystemTx, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { enqueueEmail } from '../outbox';
import { isUuid } from '../uuid';

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export type DeletionStatus = 'requested' | 'verified' | 'processing' | 'done' | 'rejected';
const OPEN: DeletionStatus[] = ['requested', 'verified', 'processing'];

export interface DeletionRequestView {
  id: string;
  clientId: string;
  status: DeletionStatus;
  requestedByClient: boolean;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Requests erasure of a client's data in this organization (S5-3, Ruling 5): a client for themselves, an owner for
 * one of their clients. One open request per client (asking again returns it). The owner is notified by email; the
 * request is audited without content.
 */
export async function requestDeletion(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientId?: unknown } = {},
  opts: { requestId?: string } = {},
): Promise<DeletionRequestView> {
  let clientId: string;
  if (actor.role === 'client') {
    if (!actor.clientId) throw notFound();
    clientId = actor.clientId;
  } else if (actor.role === 'owner') {
    if (typeof input.clientId !== 'string' || !isUuid(input.clientId)) throw notFound();
    clientId = input.clientId;
  } else {
    throw new DomainError('FORBIDDEN', 'You do not have access to this.');
  }
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, userId: true, name: true },
  });
  if (!client) throw notFound();

  const open = await tx.deletionRequest.findFirst({
    where: { subjectClientId: client.id, status: { in: OPEN } },
  });
  const row =
    open ??
    (await tx.deletionRequest.create({
      data: {
        subjectClientId: client.id,
        subjectUserId: client.userId,
        requestedBy: actor.userId,
      } as never,
    }));
  if (!open) {
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'deletion_request',
      objectId: row.id,
      action: 'deletion.requested',
      metadata: { clientId: client.id, byClient: actor.role === 'client' },
      requestId: opts.requestId,
    });
    // D-010 #4: the coach is notified. The owner of the organization receives it.
    const org = await tx.organization.findFirst({ select: { ownerUserId: true } });
    if (org && actor.role === 'client') {
      await enqueueEmail(tx, {
        kind: 'deletion_requested',
        toUserId: org.ownerUserId,
        templateKey: 'deletion_requested',
        payload: { clientName: client.name },
        idempotencyKey: `deletion-requested:${row.id}`,
      });
    }
  }
  return toView(row);
}

const toView = (r: {
  id: string;
  subjectClientId: string;
  status: DeletionStatus;
  requestedBy: string;
  subjectUserId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}): DeletionRequestView => ({
  id: r.id,
  clientId: r.subjectClientId,
  status: r.status,
  requestedByClient: r.subjectUserId !== null && r.requestedBy === r.subjectUserId,
  createdAt: r.createdAt.toISOString(),
  completedAt: r.completedAt?.toISOString() ?? null,
});

/** The open (or last) deletion request for a client, for the portal and the client page. */
export async function deletionStatusFor(
  tx: TenantTx,
  actor: ActorContext,
  clientId?: string,
): Promise<DeletionRequestView | null> {
  const id = actor.role === 'client' ? actor.clientId : clientId;
  if (!id || !isUuid(id)) return null;
  if (actor.role === 'coach') return null;
  const row = await tx.deletionRequest.findFirst({
    where: { subjectClientId: id },
    orderBy: { createdAt: 'desc' },
  });
  return row ? toView(row) : null;
}

export interface ErasureResult {
  status: 'done' | 'skipped' | 'held';
  /** Storage objects of the client's exports, for the worker to remove. */
  storageKeys: string[];
}

/**
 * Erases a verified request's data (S5-3, Ruling 5), in system scope because it spans the user's account. Within the
 * request's organization only: the client's sessions, set logs and their revisions, check-ins, messages and thread,
 * review flags, notes, pauses, invites, exports, assignments, support grants and their membership there. The client
 * row stays (immutable program history points at it) but is anonymized, as is the user account when no other
 * membership remains (their credentials and sessions are deleted). Other memberships of the same user are never
 * touched. Content-free audit. A request that isn't `verified` (already done, rejected) or is on legal hold is a
 * no-op.
 */
export async function eraseClientData(
  tx: SystemTx,
  requestId: string,
  now: Date,
): Promise<ErasureResult> {
  const req = await tx.deletionRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status !== 'verified') return { status: 'skipped', storageKeys: [] };
  if (req.legalHold) return { status: 'held', storageKeys: [] };
  const claimed = await tx.deletionRequest.updateMany({
    where: { id: req.id, status: 'verified', legalHold: false },
    data: { status: 'processing' },
  });
  if (claimed.count === 0) return { status: 'skipped', storageKeys: [] };

  const orgId = req.organizationId;
  const clientId = req.subjectClientId;
  const inClient = { organizationId: orgId, clientId };
  const ofSessions = { session: { is: { organizationId: orgId, clientId } } };

  // Lawful erasure only (migration 000029): set_log_revisions are otherwise append-only.
  await tx.$executeRaw`SELECT pg_catalog.set_config('app.lawful_erasure', 'on', true)`;
  await tx.setLogRevision.deleteMany({ where: ofSessions });
  await tx.setLog.deleteMany({ where: ofSessions });
  await tx.reviewFlag.deleteMany({ where: inClient });
  await tx.message.deleteMany({ where: { organizationId: orgId, thread: { is: { clientId } } } });
  await tx.conversationThread.deleteMany({ where: inClient });
  await tx.checkin.deleteMany({ where: inClient });
  await tx.internalNote.deleteMany({ where: inClient });
  await tx.clientPause.deleteMany({ where: inClient });
  await tx.clientInvite.deleteMany({ where: inClient });
  const exports = await tx.exportJob.findMany({ where: inClient, select: { filesJson: true } });
  await tx.exportJob.deleteMany({ where: inClient });
  await tx.workoutSession.deleteMany({ where: inClient });
  await tx.programAssignment.deleteMany({ where: inClient });
  const copies = await tx.program.findMany({
    where: { organizationId: orgId, clientId, kind: 'client' },
    select: { id: true },
  });
  await tx.programDraft.deleteMany({ where: { programId: { in: copies.map((p) => p.id) } } });
  await tx.program.updateMany({
    where: { id: { in: copies.map((p) => p.id) } },
    data: { title: 'Deleted client program', status: 'archived' },
  });
  await tx.supportAccessGrant.deleteMany({ where: inClient });
  await tx.$executeRaw`SELECT pg_catalog.set_config('app.lawful_erasure', 'off', true)`;

  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
  await tx.client.update({
    where: { id: clientId },
    data: {
      name: 'Deleted client',
      email: `deleted-${clientId}@deleted.invalid`,
      goals: null,
      startDate: null,
      userId: null,
      status: 'archived',
      consentVersion: null,
      consentAt: null,
      checkinWeekday: null,
      checkinTemplateId: null,
    },
  });
  if (client.userId) {
    await tx.membership.deleteMany({
      where: { userId: client.userId, organizationId: orgId, role: 'client' },
    });
    const others = await tx.membership.count({ where: { userId: client.userId } });
    if (others === 0) {
      await tx.session.deleteMany({ where: { userId: client.userId } });
      await tx.account.deleteMany({ where: { userId: client.userId } });
      await tx.user.update({
        where: { id: client.userId },
        data: {
          name: 'Deleted user',
          email: `deleted-${client.userId}@deleted.invalid`,
          image: null,
          emailVerified: false,
        },
      });
    }
  }
  await tx.deletionRequest.update({
    where: { id: req.id },
    data: { status: 'done', completedAt: now },
  });
  await appendAudit(tx, {
    orgId,
    actorId: null,
    objectType: 'deletion_request',
    objectId: req.id,
    action: 'deletion.completed',
    metadata: { clientId },
  });

  const storageKeys = exports.flatMap((e) =>
    Array.isArray(e.filesJson)
      ? (e.filesJson as { key?: unknown }[]).flatMap((f) =>
          typeof f.key === 'string' ? [f.key] : [],
        )
      : [],
  );
  return { status: 'done', storageKeys };
}
