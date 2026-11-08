import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { enqueueEmail } from '../outbox';

/** PRD M13: in-app support, answered by email. The published first-response target. */
export const SUPPORT_RESPONSE_TARGET =
  'We reply within 4 business hours on paid plans, and within 1 business day otherwise.';
/** `migration` (PRD M4): a coach asks for the free concierge move from another platform. */
export const SUPPORT_TOPICS = [
  'question',
  'problem',
  'idea',
  'billing',
  'privacy',
  'migration',
] as const;

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

/**
 * Sends a support request to the support inbox (`to`, from SUPPORT_EMAIL) with a reply-to of the sender's account
 * email. The audit records that a request was made, never its text.
 */
export async function requestSupport(
  tx: TenantTx,
  actor: ActorContext,
  input: { topic?: unknown; message?: unknown },
  opts: { to: string; requestId?: string; now?: Date },
): Promise<{ received: true }> {
  if (
    !(SUPPORT_TOPICS as readonly unknown[]).includes(input.topic) ||
    (input.topic === 'migration' && actor.role === 'client')
  ) {
    throw invalid('topic', 'Pick a topic.');
  }
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (message.length < 5 || message.length > 5000) {
    throw invalid('message', 'Write 5 to 5000 characters.');
  }
  const user = await tx.user.findFirst({
    where: { id: actor.userId },
    select: { name: true, email: true },
  });
  const org = await tx.organization.findFirst({
    where: { id: actor.orgId },
    select: { name: true },
  });
  const now = opts.now ?? new Date();
  await enqueueEmail(tx, {
    kind: 'support_request',
    toEmail: opts.to,
    templateKey: 'support_request',
    payload: {
      topic: input.topic as string,
      message,
      fromName: user?.name ?? '',
      fromEmail: user?.email ?? '',
      orgName: org?.name ?? '',
      role: actor.role,
    },
    idempotencyKey: `support:${actor.userId}:${now.getTime()}`,
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'organization',
    objectId: actor.orgId,
    action: 'support.requested',
    metadata: { topic: input.topic as string },
    requestId: opts.requestId,
  });
  return { received: true };
}
