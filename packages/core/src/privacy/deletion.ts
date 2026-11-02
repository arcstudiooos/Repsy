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
  // Only the owner (and the client) see deletion requests (D-010 #4).
  if (actor.role !== 'owner' && actor.role !== 'client') return null;
  const row = await tx.deletionRequest.findFirst({
    where: { subjectClientId: id },
    orderBy: { createdAt: 'desc' },
  });
  return row ? toView(row) : null;
}

export interface ErasureResult {
  status: 'done' | 'skipped' | 'held';
}

/** The erasure transaction's timeout: a long-tenured client means many deletes (C-I3). */
export const ERASURE_TIMEOUT_MS = 120_000;

/** Records a failed erasure run (a short code, never content); the request stays `verified` and is retried. */
export async function recordErasureFailure(
  tx: SystemTx,
  requestId: string,
  errorCode: string,
): Promise<void> {
  await tx.deletionRequest.updateMany({
    where: { id: requestId, status: 'verified' },
    data: { attempts: { increment: 1 }, lastErrorCode: errorCode.slice(0, 64) },
  });
}

/**
 * Erases a verified request's data (S5-3, Ruling 5), in system scope because it spans the user's account. Within the
 * request's organization only: the client's sessions, set logs and their revisions, check-ins, messages and thread,
 * review flags, notes, pauses, invites, assignments, support grants, their program copies (versions, slots and the
 * workout versions no other program uses), the emails addressed to or naming them, and their membership there. Their
 * exports, and the organization's exports built before now (they hold the client's rows), are expired at once; the
 * export sweep then removes the files from storage, retrying until it succeeds (D-I4). The client row stays (the
 * request and the audit trail point at it) but is anonymized, as is the user account when no other membership
 * remains (their credentials, sessions and platform emails are deleted). Other memberships of the same user are never
 * touched. Content-free audit. A request that isn't `verified` (already done, rejected) or is on legal hold is a
 * no-op.
 */
export async function eraseClientData(
  tx: SystemTx,
  requestId: string,
  now: Date,
): Promise<ErasureResult> {
  const req = await tx.deletionRequest.findUnique({ where: { id: requestId } });
  if (!req || req.status !== 'verified') return { status: 'skipped' };
  if (req.legalHold) return { status: 'held' };
  const claimed = await tx.deletionRequest.updateMany({
    where: { id: req.id, status: 'verified', legalHold: false },
    data: { status: 'processing' },
  });
  if (claimed.count === 0) return { status: 'skipped' };

  const orgId = req.organizationId;
  const clientId = req.subjectClientId;
  const inClient = { organizationId: orgId, clientId };
  const ofSessions = { session: { is: { organizationId: orgId, clientId } } };
  const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
  const othersAfter = client.userId
    ? await tx.membership.count({
        where: {
          userId: client.userId,
          NOT: { organizationId: orgId, role: 'client' },
        },
      })
    : 0;

  // Lawful erasure only (migrations 000029-000031, 000033): set_log_revisions, metric_entry_revisions, messages and
  // committed program history are otherwise immutable.
  await tx.$executeRaw`SELECT pg_catalog.set_config('app.lawful_erasure', 'on', true)`;
  await tx.setLogRevision.deleteMany({ where: ofSessions });
  // PRD B14: their agreement acceptances (insert-only otherwise).
  await tx.agreementAcceptance.deleteMany({ where: inClient });
  await tx.setLog.deleteMany({ where: ofSessions });
  await tx.sessionExerciseSwap.deleteMany({ where: ofSessions });
  await tx.sessionNote.deleteMany({ where: ofSessions });
  // D-011 #5: photos and form-check videos are removed now; their files are marked for the media purge job.
  await tx.sessionMedia.deleteMany({ where: ofSessions });
  await tx.progressPhoto.deleteMany({ where: inClient });
  // PRD E5: assessments asked of them, with their photos (the files are marked below).
  await tx.assessmentPhoto.deleteMany({
    where: { organizationId: orgId, clientAssessment: { is: { clientId } } },
  });
  await tx.clientAssessment.deleteMany({ where: inClient });
  // PRD E10: their monthly reports (the coach's summaries).
  await tx.progressReport.deleteMany({ where: inClient });
  // PRD G8: which meal plans they were given (the plans are the workspace's).
  await tx.clientMealPlan.deleteMany({ where: inClient });
  await tx.mediaFile.updateMany({
    where: { ...inClient, erasedAt: null },
    data: { erasedAt: now },
  });
  await tx.reviewFlag.deleteMany({ where: inClient });
  // PRD I4: the days they opened the portal.
  await tx.portalVisit.deleteMany({ where: inClient });
  // PRD J2, J8: their automation events and runs (step runs go with their run).
  await tx.clientEvent.deleteMany({ where: inClient });
  await tx.sequenceRun.deleteMany({ where: inClient });
  // PRD G4: their course enrolments (lesson completions go with them).
  await tx.courseEnrollment.deleteMany({ where: inClient });
  const messageIds = (
    await tx.message.findMany({
      where: { organizationId: orgId, thread: { is: { clientId } } },
      select: { id: true },
    })
  ).map((m) => m.id);
  await tx.message.deleteMany({ where: { id: { in: messageIds } } });
  // PRD H5: messages still waiting to go out to them, and the history of sent ones.
  await tx.scheduledMessage.deleteMany({
    where: { organizationId: orgId, thread: { is: { clientId } } },
  });
  await tx.conversationThread.deleteMany({ where: inClient });
  await tx.checkin.deleteMany({ where: inClient });
  await tx.internalNote.deleteMany({ where: inClient });
  await tx.metricEntryRevision.deleteMany({ where: inClient });
  await tx.metricEntry.deleteMany({ where: inClient });
  await tx.goal.deleteMany({ where: inClient });
  await tx.resource.deleteMany({ where: inClient });
  await tx.habitLog.deleteMany({ where: inClient });
  await tx.habit.deleteMany({ where: inClient });
  await tx.clientTagLink.deleteMany({ where: inClient });
  await tx.nutritionLog.deleteMany({ where: inClient });
  await tx.nutritionTarget.deleteMany({ where: inClient });
  await tx.clientPause.deleteMany({ where: inClient });
  const inviteIds = (await tx.clientInvite.findMany({ where: inClient, select: { id: true } })).map(
    (i) => i.id,
  );
  await tx.clientInvite.deleteMany({ where: inClient });
  // Blank extra workouts (PRD D13) are built by the client and may carry a title they typed.
  const extraVersionIds = (
    await tx.workoutSession.findMany({
      where: { ...inClient, kind: 'extra', workoutVersionId: { not: null } },
      select: { workoutVersionId: true },
    })
  ).flatMap((r) => (r.workoutVersionId ? [r.workoutVersionId] : []));
  await tx.workoutSession.deleteMany({ where: inClient });
  await tx.programAssignment.deleteMany({ where: inClient });
  await eraseProgramCopies(tx, orgId, clientId);
  await eraseUnusedWorkoutVersions(tx, extraVersionIds);
  await tx.supportAccessGrant.deleteMany({ where: inClient });

  // Emails addressed to the client, or naming them (C-I2): invites (to their address), check-in and message
  // notifications (to their account), the owner's "deletion requested" and "new message" notifications. Pending ones
  // are never sent; sent ones are no longer kept.
  await tx.outboxEmail.deleteMany({
    where: {
      organizationId: orgId,
      OR: [
        { toEmail: client.email },
        ...(client.userId ? [{ toUserId: client.userId }] : []),
        {
          idempotencyKey: {
            in: [
              `deletion-requested:${req.id}`,
              ...messageIds.map((id) => `new-message:${id}`),
              ...inviteIds.map((id) => `client_invite:${id}`),
            ],
          },
        },
      ],
    },
  });
  if (client.userId && othersAfter === 0) {
    await tx.outboxEmail.deleteMany({ where: { organizationId: null, toUserId: client.userId } });
  }
  await tx.$executeRaw`SELECT pg_catalog.set_config('app.lawful_erasure', 'off', true)`;

  // Exports (D-I4): the client's own, and every organization export built (or being built) before now, hold the
  // client's rows. Expired now, so no link works any more; the export sweep removes the files. A build in progress
  // goes back to the queue, so the files it writes are discarded and it rebuilds without the client.
  await tx.exportJob.updateMany({
    where: {
      organizationId: orgId,
      status: 'done',
      purgedAt: null,
      OR: [{ clientId }, { scope: 'org', createdAt: { lte: now } }],
    },
    data: { expiresAt: now },
  });
  await tx.exportJob.updateMany({
    where: { organizationId: orgId, scope: 'org', status: 'running' },
    data: { status: 'queued', claimedAt: null },
  });
  await tx.exportJob.updateMany({
    where: { ...inClient, status: { in: ['queued', 'running'] } },
    data: { status: 'failed', errorCode: 'ERASED', claimedAt: null },
  });

  await tx.client.update({
    where: { id: clientId },
    data: {
      name: 'Deleted client',
      email: `deleted-${clientId}@deleted.invalid`,
      goals: null,
      motivation: null,
      scheduleNotes: null,
      equipmentNotes: null,
      equipment: [],
      trainingLocation: null,
      preferences: null,
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
    // PRD H11: nothing more is pushed to them from this workspace.
    await tx.outboxPush.deleteMany({ where: { toUserId: client.userId, organizationId: orgId } });
    if (othersAfter === 0) {
      await tx.session.deleteMany({ where: { userId: client.userId } });
      await tx.account.deleteMany({ where: { userId: client.userId } });
      await tx.twoFactor.deleteMany({ where: { userId: client.userId } });
      await tx.pushSubscription.deleteMany({ where: { userId: client.userId } });
      await tx.user.update({
        where: { id: client.userId },
        data: {
          name: 'Deleted user',
          email: `deleted-${client.userId}@deleted.invalid`,
          image: null,
          emailVerified: false,
          twoFactorEnabled: false,
        },
      });
    }
  }
  await tx.deletionRequest.update({
    where: { id: req.id },
    data: { status: 'done', completedAt: now, lastErrorCode: null },
  });
  await appendAudit(tx, {
    orgId,
    actorId: null,
    objectType: 'deletion_request',
    objectId: req.id,
    action: 'deletion.completed',
    metadata: { clientId },
  });
  return { status: 'done' };
}

/**
 * Deletes the client's program copies (C-I2, Ruling 5): coach-written, client-specific text. Their slots and versions,
 * the workout versions only they used (a copy shares the template's workout versions until it is edited), and the
 * program rows. Must run with app.lawful_erasure on, after the client's sessions and set logs are gone.
 */
async function eraseProgramCopies(tx: SystemTx, orgId: string, clientId: string): Promise<void> {
  const programIds = (
    await tx.program.findMany({
      where: { organizationId: orgId, clientId, kind: 'client' },
      select: { id: true },
    })
  ).map((p) => p.id);
  if (programIds.length === 0) return;
  const versionIds = (
    await tx.programVersion.findMany({
      where: { organizationId: orgId, programId: { in: programIds } },
      select: { id: true },
    })
  ).map((v) => v.id);
  const workoutVersionIds = [
    ...new Set(
      (
        await tx.programSlot.findMany({
          where: { organizationId: orgId, programVersionId: { in: versionIds } },
          select: { workoutVersionId: true },
        })
      ).map((s) => s.workoutVersionId),
    ),
  ];
  await tx.program.updateMany({
    where: { id: { in: programIds } },
    data: { currentVersionId: null },
  });
  await tx.programSlot.deleteMany({
    where: { organizationId: orgId, programVersionId: { in: versionIds } },
  });
  await tx.programVersion.deleteMany({ where: { id: { in: versionIds } } });
  await eraseUnusedWorkoutVersions(tx, workoutVersionIds);
  await tx.program.deleteMany({ where: { id: { in: programIds } } });
}

/** Deletes those of `ids` no template, copy (slots) or remaining session uses. Run with app.lawful_erasure on. */
async function eraseUnusedWorkoutVersions(tx: SystemTx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const unused = await tx.workoutVersion.findMany({
    where: { id: { in: [...new Set(ids)] }, slots: { none: {} }, workoutSessions: { none: {} } },
    select: { id: true },
  });
  const unusedIds = unused.map((w) => w.id);
  await tx.workoutVersionExercise.deleteMany({ where: { workoutVersionId: { in: unusedIds } } });
  await tx.workoutVersion.deleteMany({ where: { id: { in: unusedIds } } });
}
