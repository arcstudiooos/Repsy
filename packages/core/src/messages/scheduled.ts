import { appendAudit, withSystem, withTenant, type PrismaClient, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { zonedTimeToUtc } from '../timezone';
import { isUuid } from '../uuid';
import { getClientThread, MESSAGE_MAX, sendMessage } from './messages';

/**
 * PRD H5: a coach writes a message now and picks when it goes out, as a date and time in the client's time zone. The
 * worker (`messages.scheduled`, every minute) sends it through `sendMessage`, as the coach, so it reaches the client
 * like any other message (email and push included).
 */
export const SCHEDULED_PER_THREAD = 20;
const MAX_AHEAD_MS = 90 * 86_400_000;

export interface ScheduledMessageView {
  id: string;
  body: string;
  sendAt: string;
  /** The client's wall-clock date and time it goes out at. */
  localDate: string;
  localTime: string;
  timezone: string;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const coachOnly = (actor: ActorContext) => {
  assertCan(actor, 'message:send');
  if (actor.role === 'client')
    throw new DomainError('FORBIDDEN', 'You do not have access to this.');
};

function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
    localTime: `${get('hour')}:${get('minute')}`,
  };
}

const view = (
  r: { id: string; body: string; sendAt: Date },
  timezone: string,
): ScheduledMessageView => ({
  id: r.id,
  body: r.body,
  sendAt: r.sendAt.toISOString(),
  ...wallClock(r.sendAt, timezone),
  timezone,
});

export async function scheduleMessage(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  input: { body?: unknown; localDate?: unknown; localTime?: unknown },
  opts: { now?: Date; requestId?: string } = {},
): Promise<ScheduledMessageView> {
  coachOnly(actor);
  const thread = await getClientThread(tx, actor, clientId);
  if (!thread.canPost) throw new DomainError('CONFLICT', 'This conversation is closed.');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (body === '') throw invalid('body', 'Write a message.');
  if (body.length > MESSAGE_MAX) throw invalid('body', `Use at most ${MESSAGE_MAX} characters.`);
  const client = await tx.client.findFirstOrThrow({
    where: { id: clientId },
    select: { timezone: true },
  });
  const sendAt =
    typeof input.localDate === 'string' && typeof input.localTime === 'string'
      ? zonedTimeToUtc(input.localDate, input.localTime, client.timezone)
      : null;
  if (!sendAt) throw invalid('sendAt', 'Pick a date and time.');
  const now = opts.now ?? new Date();
  if (sendAt.getTime() < now.getTime() + 60_000)
    throw invalid('sendAt', 'Pick a time in the future.');
  if (sendAt.getTime() > now.getTime() + MAX_AHEAD_MS) {
    throw invalid('sendAt', 'Schedule at most 90 days ahead.');
  }
  const pending = await tx.scheduledMessage.count({
    where: { threadId: thread.id, sentAt: null, cancelledAt: null },
  });
  if (pending >= SCHEDULED_PER_THREAD) {
    throw new DomainError(
      'CONFLICT',
      `At most ${SCHEDULED_PER_THREAD} messages can wait to be sent.`,
    );
  }
  const row = await tx.scheduledMessage.create({
    data: { threadId: thread.id, senderUserId: actor.userId, body, sendAt },
  } as Parameters<typeof tx.scheduledMessage.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'scheduled_message',
    objectId: row.id,
    action: 'message.scheduled',
    metadata: { clientId, sendAt: sendAt.toISOString() },
    requestId: opts.requestId,
  });
  return view(row, client.timezone);
}

/** The client's messages still waiting to go out, soonest first. */
export async function listScheduledMessages(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<ScheduledMessageView[]> {
  coachOnly(actor);
  const thread = await getClientThread(tx, actor, clientId);
  const client = await tx.client.findFirstOrThrow({
    where: { id: clientId },
    select: { timezone: true },
  });
  const rows = await tx.scheduledMessage.findMany({
    where: { threadId: thread.id, sentAt: null, cancelledAt: null, failure: null },
    orderBy: { sendAt: 'asc' },
    select: { id: true, body: true, sendAt: true },
  });
  return rows.map((r) => view(r, client.timezone));
}

export async function cancelScheduledMessage(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  opts: { now?: Date; requestId?: string } = {},
): Promise<void> {
  coachOnly(actor);
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.scheduledMessage.updateMany({
    where: { id, sentAt: null, cancelledAt: null },
    data: { cancelledAt: opts.now ?? new Date() },
  });
  if (count === 0) throw new DomainError('CONFLICT', 'That message was already sent or cancelled.');
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'scheduled_message',
    objectId: id,
    action: 'message.schedule_cancelled',
    requestId: opts.requestId,
  });
}

/**
 * Worker: sends every due message, each in its own tenant transaction as its coach. A coach who has left the
 * workspace, or a closed conversation, marks the row failed (shown nowhere to the client) rather than retrying.
 */
export async function sendDueScheduledMessages(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ sent: number; failed: number }> {
  const due = await withSystem(
    (tx) =>
      tx.scheduledMessage.findMany({
        where: { sendAt: { lte: now }, sentAt: null, cancelledAt: null, failure: null },
        orderBy: { sendAt: 'asc' },
        take: 200,
        select: { id: true, organizationId: true, threadId: true, senderUserId: true, body: true },
      }),
    prisma,
  );
  let sent = 0;
  let failed = 0;
  for (const m of due) {
    const outcome = await withTenant(
      m.organizationId,
      async (tx) => {
        const member = await tx.membership.findFirst({
          where: { userId: m.senderUserId, status: 'active', role: { in: ['owner', 'coach'] } },
          select: { role: true },
        });
        if (!member) return 'The coach is no longer in this workspace.';
        const actor: ActorContext = {
          userId: m.senderUserId,
          orgId: m.organizationId,
          role: member.role as ActorContext['role'],
          isPlatformAdmin: false,
        };
        try {
          const msg = await sendMessage(
            tx,
            actor,
            m.threadId,
            { body: m.body, clientMessageId: m.id },
            { now },
          );
          await tx.scheduledMessage.update({
            where: { id: m.id },
            data: { sentAt: now, messageId: msg.id },
          });
          return null;
        } catch (error) {
          if (error instanceof DomainError) return error.message;
          throw error;
        }
      },
      prisma,
      { userId: m.senderUserId },
    ).catch(() => undefined);
    if (outcome === null) sent += 1;
    else if (typeof outcome === 'string') {
      failed += 1;
      await withSystem(
        (tx) =>
          tx.scheduledMessage.update({
            where: { id: m.id },
            data: { failure: outcome.slice(0, 200) },
          }),
        prisma,
      );
    }
  }
  return { sent, failed };
}
