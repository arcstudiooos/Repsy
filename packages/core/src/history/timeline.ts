import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { fromDbDate } from '../sessions/read';
import { isUuid } from '../uuid';

const PER_SOURCE = 100;
export const TIMELINE_MAX = 200;

export type TimelineKind =
  'assignment' | 'program_version' | 'session' | 'correction' | 'checkin' | 'pause' | 'note';

export interface TimelineEvent {
  /** Stable per event (source id plus what happened). */
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string | null;
  href: string | null;
  /** A private coach note (shown distinctly from anything the client sees). */
  private: boolean;
}

const STATE_TITLE = {
  completed: 'Completed',
  skipped: 'Skipped',
  missed: 'Missed',
  incomplete: 'Not finished',
} as const;

/**
 * A client's history for their coach (S4-5): assignments and program versions, finished and missed sessions, log
 * corrections, check-ins, pauses and private notes, newest first. Coach/owner only (it includes notes).
 */
export async function getClientTimeline(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<TimelineEvent[]> {
  assertCan(actor, 'note:read');
  if (!isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const client = await tx.client.findFirst({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new DomainError('NOT_FOUND', 'Not found.');
  const base = `/app/clients/${clientId}`;
  const out: TimelineEvent[] = [];
  const push = (e: Omit<TimelineEvent, 'detail' | 'href' | 'private'> & Partial<TimelineEvent>) =>
    out.push({ detail: null, href: null, private: false, ...e });

  const assignments = await tx.programAssignment.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    take: PER_SOURCE,
    select: {
      id: true,
      createdAt: true,
      endedAt: true,
      startLocalDate: true,
      program: { select: { title: true } },
    },
  });
  for (const a of assignments) {
    push({
      id: `assignment:${a.id}:assigned`,
      kind: 'assignment',
      at: a.createdAt.toISOString(),
      title: `Program assigned: ${a.program.title}`,
      detail: `Starts ${fromDbDate(a.startLocalDate)}`,
      href: `${base}/program`,
    });
    if (a.endedAt) {
      push({
        id: `assignment:${a.id}:ended`,
        kind: 'assignment',
        at: a.endedAt.toISOString(),
        title: `Program ended: ${a.program.title}`,
      });
    }
  }

  const versions = await tx.programVersion.findMany({
    where: { program: { is: { clientId, kind: 'client' } }, versionNo: { gt: 1 } },
    orderBy: { committedAt: 'desc' },
    take: PER_SOURCE,
    select: {
      id: true,
      versionNo: true,
      committedAt: true,
      programId: true,
      program: { select: { title: true } },
    },
  });
  for (const v of versions) {
    push({
      id: `version:${v.id}`,
      kind: 'program_version',
      at: v.committedAt.toISOString(),
      title: `Program updated: ${v.program.title} version ${v.versionNo}`,
      href: `/app/programs/${v.programId}/versions/${v.versionNo}`,
    });
  }

  const sessions = await tx.workoutSession.findMany({
    where: { clientId, state: { in: ['completed', 'skipped', 'missed', 'incomplete'] } },
    orderBy: { dueAt: 'desc' },
    take: PER_SOURCE,
    select: {
      id: true,
      state: true,
      dueAt: true,
      completedAt: true,
      submittedAt: true,
      scheduledLocalDate: true,
      loggedByUserId: true,
      workoutVersion: { select: { title: true } },
    },
  });
  for (const s of sessions) {
    const state = s.state as keyof typeof STATE_TITLE;
    const at = s.completedAt ?? s.submittedAt ?? s.dueAt;
    push({
      id: `session:${s.id}:${state}`,
      kind: 'session',
      at: at.toISOString(),
      title: `${STATE_TITLE[state]}: ${s.workoutVersion?.title ?? 'Workout'}`,
      detail: `Scheduled ${fromDbDate(s.scheduledLocalDate)}${s.loggedByUserId ? ' · Logged by coach' : ''}`,
      href: `${base}/sessions/${s.id}`,
    });
  }

  const revisions = await tx.setLogRevision.findMany({
    where: { session: { is: { clientId } } },
    orderBy: { createdAt: 'desc' },
    take: PER_SOURCE,
    select: { id: true, createdAt: true, revisedByRole: true, sessionId: true },
  });
  for (const r of revisions) {
    push({
      id: `revision:${r.id}`,
      kind: 'correction',
      at: r.createdAt.toISOString(),
      title: r.revisedByRole === 'coach' ? 'Log corrected by coach' : 'Log edited by client',
      href: `${base}/sessions/${r.sessionId}`,
    });
  }

  const checkins = await tx.checkin.findMany({
    where: { clientId },
    orderBy: { issuedAt: 'desc' },
    take: PER_SOURCE,
    select: { id: true, issuedAt: true, submittedAt: true, periodLocalDate: true },
  });
  for (const c of checkins) {
    const week = `Week of ${fromDbDate(c.periodLocalDate)}`;
    push({
      id: `checkin:${c.id}:issued`,
      kind: 'checkin',
      at: c.issuedAt.toISOString(),
      title: 'Check-in sent to client',
      detail: week,
      href: `${base}/check-ins`,
    });
    if (c.submittedAt) {
      push({
        id: `checkin:${c.id}:submitted`,
        kind: 'checkin',
        at: c.submittedAt.toISOString(),
        title: 'Check-in answered',
        detail: week,
        href: `${base}/check-ins`,
      });
    }
  }

  const pauses = await tx.clientPause.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    take: PER_SOURCE,
    select: {
      id: true,
      createdAt: true,
      endedAt: true,
      startLocalDate: true,
      resumeLocalDate: true,
    },
  });
  for (const p of pauses) {
    push({
      id: `pause:${p.id}:paused`,
      kind: 'pause',
      at: p.createdAt.toISOString(),
      title: 'Program paused',
      detail: `${fromDbDate(p.startLocalDate)} to ${fromDbDate(p.resumeLocalDate)}`,
    });
    if (p.endedAt) {
      push({
        id: `pause:${p.id}:resumed`,
        kind: 'pause',
        at: p.endedAt.toISOString(),
        title: 'Program resumed',
      });
    }
  }

  const notes = await tx.internalNote.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    take: PER_SOURCE,
    select: { id: true, createdAt: true, body: true, author: { select: { name: true } } },
  });
  for (const n of notes) {
    push({
      id: `note:${n.id}`,
      kind: 'note',
      at: n.createdAt.toISOString(),
      title: `Private note by ${(n.author as { name: string } | null)?.name ?? 'Coach'}`,
      detail: n.body,
      href: `${base}/notes`,
      private: true,
    });
  }

  return out
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .slice(0, TIMELINE_MAX);
}
