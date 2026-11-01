import { createHash } from 'node:crypto';
import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { getClientThread, MESSAGE_MAX, sendMessage, type MessageSentHook } from './messages';

/** At most this many recipients per broadcast (well above the pilot's 30 active clients). */
export const BROADCAST_MAX_RECIPIENTS = 200;

export interface BroadcastAudience {
  /** "all" or a tag id. */
  key: string;
  label: string;
  /** Clients who would receive it: joined (have an account) and active or paused. */
  count: number;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

function recipientsWhere(tagId: string | null, clientIds: string[] | null = null) {
  return {
    status: { in: ['active', 'paused'] as ('active' | 'paused')[] },
    userId: { not: null },
    ...(tagId ? { tagLinks: { some: { tagId } } } : {}),
    ...(clientIds ? { id: { in: clientIds } } : {}),
  };
}

/** Who a broadcast can go to (PRD H6): everyone, or a tag, with recipient counts. */
export async function broadcastAudiences(
  tx: TenantTx,
  actor: ActorContext,
): Promise<BroadcastAudience[]> {
  assertCan(actor, 'message:send');
  if (actor.role === 'client')
    throw new DomainError('FORBIDDEN', 'You do not have access to this.');
  const all = await tx.client.count({ where: recipientsWhere(null) });
  const tags = await tx.clientTag.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const out: BroadcastAudience[] = [{ key: 'all', label: 'All active clients', count: all }];
  for (const t of tags) {
    out.push({
      key: t.id,
      label: `Tag: ${t.name}`,
      count: await tx.client.count({ where: recipientsWhere(t.id) }),
    });
  }
  return out;
}

/** A stable per-recipient message id from the broadcast's idempotency key, so a retried broadcast sends nothing twice. */
function messageKey(broadcastKey: string, clientId: string): string {
  const h = createHash('sha256').update(`${broadcastKey}:${clientId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Sends one message to everyone in an audience (PRD H6) as an individual message in each client's own thread, so
 * replies stay private and every message has the usual unread state and email opt-in. Coaches only; text only
 * (D-008 #1). Clients without an account yet (not joined) are skipped.
 */
export async function broadcastMessage(
  tx: TenantTx,
  actor: ActorContext,
  /** `audience`: "all", a tag id, or "selected" with `clientIds` (PRD B5). */
  input: { audience?: unknown; body?: unknown; idempotencyKey?: unknown; clientIds?: unknown },
  opts: { now?: Date; requestId?: string; onSent?: MessageSentHook } = {},
): Promise<{ sent: number }> {
  assertCan(actor, 'message:send');
  if (actor.role === 'client')
    throw new DomainError('FORBIDDEN', 'You do not have access to this.');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body.length < 1) throw invalid('body', 'Write a message.');
  if (body.length > MESSAGE_MAX) throw invalid('body', `Use at most ${MESSAGE_MAX} characters.`);
  if (!isUuid(input.idempotencyKey)) throw invalid('idempotencyKey', 'Invalid id.');
  let tagId: string | null = null;
  let picked: string[] | null = null;
  if (input.audience === 'selected') {
    const ids = input.clientIds;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((c) => isUuid(c))) {
      throw invalid('clientIds', 'Pick at least one client.');
    }
    picked = [...new Set((ids as string[]).map((c) => c.toLowerCase()))];
  } else if (input.audience !== 'all') {
    if (!isUuid(input.audience)) throw invalid('audience', 'Pick who to send to.');
    const tag = await tx.clientTag.findFirst({
      where: { id: input.audience },
      select: { id: true },
    });
    if (!tag) throw invalid('audience', 'Pick who to send to.');
    tagId = tag.id;
  }
  const clients = await tx.client.findMany({
    where: recipientsWhere(tagId, picked),
    orderBy: { name: 'asc' },
    select: { id: true },
  });
  if (clients.length === 0) throw invalid('audience', 'No joined clients in this group yet.');
  if (clients.length > BROADCAST_MAX_RECIPIENTS) {
    throw invalid('audience', `Send to at most ${BROADCAST_MAX_RECIPIENTS} clients at once.`);
  }
  for (const c of clients) {
    const thread = await getClientThread(tx, actor, c.id);
    await sendMessage(
      tx,
      actor,
      thread.id,
      { body, clientMessageId: messageKey(input.idempotencyKey, c.id) },
      opts,
    );
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'organization',
    objectId: actor.orgId,
    action: 'message.broadcast',
    metadata: {
      recipients: clients.length,
      audience: picked ? 'selected' : tagId ? 'tag' : 'all',
    },
    requestId: opts.requestId,
  });
  return { sent: clients.length };
}
