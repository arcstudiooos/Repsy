import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { lockSession } from './lifecycle';
import { READINESS_QUESTIONS, readinessScore, type ReadinessAnswers } from './readiness-questions';

export interface ReadinessView {
  score: number;
  answers: ReadinessAnswers;
  at: string;
}

/** A stored readiness check, or null when absent or unreadable. */
export function readReadiness(
  json: unknown,
  score: number | null,
  at: Date | null,
): ReadinessView | null {
  if (!json || typeof json !== 'object' || score === null || !at) return null;
  const v = json as Record<string, unknown>;
  const answers = {} as ReadinessAnswers;
  for (const q of READINESS_QUESTIONS) {
    const n = v[q.key];
    if (typeof n !== 'number') return null;
    answers[q.key] = n;
  }
  return { score, answers, at: at.toISOString() };
}

/**
 * Records the client's readiness check (PRD D17) before or just after Start; a second answer replaces the first.
 * Only the client answers it, and only while the workout is not finished.
 */
export async function recordReadiness(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  input: Record<string, unknown>,
  opts: { now?: Date; requestId?: string } = {},
): Promise<ReadinessView> {
  assertCan(actor, 'session:log');
  if (actor.role !== 'client') {
    throw new DomainError('FORBIDDEN', 'Only the client answers the readiness check.');
  }
  const answers = {} as ReadinessAnswers;
  const errors: Record<string, string[]> = {};
  for (const q of READINESS_QUESTIONS) {
    const v = input[q.key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) {
      errors[q.key] = ['Pick 1 to 5.'];
    } else answers[q.key] = v;
  }
  if (Object.keys(errors).length)
    throw new DomainError('VALIDATION', 'Some fields are invalid.', errors);
  const now = opts.now ?? new Date();
  const session = await lockSession(tx, actor, sessionId);
  if (!['scheduled', 'in_progress', 'missed'].includes(session.state)) {
    throw new DomainError(
      'SESSION_FINISHED',
      'This workout is already finished and can no longer change.',
    );
  }
  const score = readinessScore(answers);
  await tx.workoutSession.update({
    where: { id: session.id },
    data: { readinessJson: answers, readinessScore: score, readinessAt: now },
  });
  // Scores only: answers are health data and stay out of audit payloads.
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'session',
    objectId: session.id,
    action: 'session.readiness_recorded',
    metadata: { clientId: session.clientId },
    requestId: opts.requestId,
  });
  return { score, answers, at: now.toISOString() };
}
