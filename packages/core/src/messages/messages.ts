import { anchorOf, resolveAnchor, type MessageAnchor } from './anchors';
import { ownMedia } from '../media/media';
import { appendAudit, wantsMessageEmail, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { escapeLike } from '../clients/clients';
import { DomainError } from '../errors';
import { enqueuePush } from '../notifications/push';
import { enqueueEmail } from '../outbox';
import { isUuid } from '../uuid';

/** D-008 #1 / S4-4: text only, immutable, at most 4,000 characters. */
export const MESSAGE_MAX = 4000;
export const MESSAGE_PAGE_SIZE = 30;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export interface MessageView {
  id: string;
  threadId: string;
  senderUserId: string;
  senderName: string;
  /** From the acting user. */
  mine: boolean;
  body: string;
  createdAt: string;
  readAt: string | null;
  /** PRD H3: the workout or check-in it is about, if any. */
  anchor?: MessageAnchor | null;
  /** PRD H2: an image or PDF sent with it. */
  attachment?: { mediaId: string; contentType: string } | null;
}

export interface ThreadSummary {
  id: string;
  clientId: string;
  clientName: string;
  clientStatus: 'invited' | 'active' | 'paused' | 'archived';
  /** Messages to the acting user not yet read. */
  unread: number;
  lastMessageAt: string | null;
  /** The newest message, for the inbox list (UI only: never logged, audited or tracked). */
  lastMessage: { body: string; mine: boolean } | null;
}

export interface ThreadView extends ThreadSummary {
  /** False for an archived client (Ruling 6). */
  canPost: boolean;
}

/** One thread per client (Ruling 6), created on first open; the coach is the client's coach. */
async function ensureThread(tx: TenantTx, clientId: string) {
  const existing = await tx.conversationThread.findFirst({ where: { clientId } });
  if (existing) return existing;
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, coachUserId: true },
  });
  if (!client) throw notFound();
  await tx.conversationThread.createMany({
    data: [{ clientId: client.id, coachUserId: client.coachUserId } as never],
    skipDuplicates: true,
  });
  return tx.conversationThread.findFirstOrThrow({ where: { clientId } });
}

/** The thread an actor may use: a client only their own; a coach any in the organization. */
async function threadFor(tx: TenantTx, actor: ActorContext, threadId: string) {
  if (!isUuid(threadId)) throw notFound();
  const where =
    actor.role === 'client'
      ? { id: threadId, clientId: actor.clientId ?? '00000000-0000-0000-0000-000000000000' }
      : { id: threadId };
  const thread = await tx.conversationThread.findFirst({
    where,
    select: {
      id: true,
      clientId: true,
      coachUserId: true,
      client: { select: { name: true, status: true, userId: true } },
    },
  });
  if (!thread) throw notFound();
  return thread;
}

async function summarizeThread(
  tx: TenantTx,
  actor: ActorContext,
  thread: {
    id: string;
    clientId: string;
    client: { name: string; status: ThreadSummary['clientStatus'] };
  },
): Promise<ThreadSummary> {
  const last = await tx.message.findFirst({
    where: { threadId: thread.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { body: true, senderUserId: true, createdAt: true },
  });
  const unread = await tx.message.count({
    where: { threadId: thread.id, readAt: null, senderUserId: { not: actor.userId } },
  });
  return {
    id: thread.id,
    clientId: thread.clientId,
    clientName: thread.client.name,
    clientStatus: thread.client.status,
    unread,
    lastMessageAt: last?.createdAt.toISOString() ?? null,
    lastMessage: last ? { body: last.body, mine: last.senderUserId === actor.userId } : null,
  };
}

/** The acting client's own thread (created on first open). */
export async function getMyThread(tx: TenantTx, actor: ActorContext): Promise<ThreadView> {
  assertCan(actor, 'message:read');
  if (actor.role !== 'client' || !actor.clientId) throw notFound();
  const { id } = await ensureThread(tx, actor.clientId);
  return getThread(tx, actor, id);
}

/** A client's thread for their coach (created on first open). */
export async function getClientThread(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<ThreadView> {
  assertCan(actor, 'message:read');
  if (actor.role === 'client' || !isUuid(clientId)) throw notFound();
  const { id } = await ensureThread(tx, clientId);
  return getThread(tx, actor, id);
}

export async function getThread(
  tx: TenantTx,
  actor: ActorContext,
  threadId: string,
): Promise<ThreadView> {
  assertCan(actor, 'message:read');
  const thread = await threadFor(tx, actor, threadId);
  return {
    ...(await summarizeThread(tx, actor, thread)),
    canPost: thread.client.status !== 'archived',
  };
}

/** The coach inbox: every thread in the organization, most recent activity first. */
export async function listThreads(tx: TenantTx, actor: ActorContext): Promise<ThreadSummary[]> {
  assertCan(actor, 'message:read');
  if (actor.role === 'client')
    throw new DomainError('FORBIDDEN', 'You do not have access to this.');
  const threads = await tx.conversationThread.findMany({
    select: { id: true, clientId: true, client: { select: { name: true, status: true } } },
  });
  const out: ThreadSummary[] = [];
  for (const t of threads) out.push(await summarizeThread(tx, actor, t));
  return out.sort(
    (a, b) =>
      (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '') ||
      a.clientName.localeCompare(b.clientName),
  );
}

/** Unread messages to the acting user across their threads (nav badge). */
export async function unreadMessageCount(tx: TenantTx, actor: ActorContext): Promise<number> {
  assertCan(actor, 'message:read');
  const scope =
    actor.role === 'client' ? { thread: { is: { clientId: actor.clientId ?? '' } } } : {};
  return tx.message.count({
    where: { ...scope, readAt: null, senderUserId: { not: actor.userId } },
  });
}

/** Opaque keyset cursor over `(createdAt, id)`, newest first. */
const encode = (row: { createdAt: Date; id: string }) =>
  Buffer.from(JSON.stringify({ c: row.createdAt.toISOString(), i: row.id })).toString('base64url');

function decode(cursor: string): { createdAt: Date; id: string } {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      c?: unknown;
      i?: unknown;
    };
    const createdAt = new Date(String(v.c));
    if (typeof v.i !== 'string' || !isUuid(v.i) || Number.isNaN(createdAt.getTime()))
      throw new Error();
    return { createdAt, id: v.i };
  } catch {
    throw invalid('cursor', 'Invalid cursor.');
  }
}

/**
 * One page of a thread, newest first (30 per page). Listing the first page marks every message to the acting user
 * as read (Ruling 6: read when the recipient views the thread).
 */
export async function listMessages(
  tx: TenantTx,
  actor: ActorContext,
  threadId: string,
  query: { cursor?: string } = {},
  opts: { now?: Date } = {},
): Promise<{ items: MessageView[]; nextCursor: string | null }> {
  assertCan(actor, 'message:read');
  const thread = await threadFor(tx, actor, threadId);
  const now = opts.now ?? new Date();
  if (query.cursor === undefined) {
    // Only the other party's messages (PR #2 review B M-7): an owner opening a coach's thread doesn't mark the
    // coach's messages to the client as read.
    const fromOtherParty =
      actor.role === 'client'
        ? { senderUserId: { not: actor.userId } }
        : thread.client.userId
          ? { senderUserId: thread.client.userId }
          : null;
    if (fromOtherParty) {
      await tx.message.updateMany({
        where: { threadId: thread.id, readAt: null, ...fromOtherParty },
        data: { readAt: now },
      });
    }
  }
  const c = query.cursor !== undefined ? decode(query.cursor) : null;
  const rows = await tx.message.findMany({
    where: {
      threadId: thread.id,
      ...(c
        ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MESSAGE_PAGE_SIZE + 1,
    select: {
      id: true,
      threadId: true,
      senderUserId: true,
      body: true,
      createdAt: true,
      readAt: true,
      anchorType: true,
      anchorId: true,
      anchorLabel: true,
      attachment: { select: { id: true, contentType: true } },
      sender: { select: { name: true } },
    },
  });
  const page = rows.slice(0, MESSAGE_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      senderUserId: m.senderUserId,
      senderName: m.sender.name,
      mine: m.senderUserId === actor.userId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt?.toISOString() ?? null,
      anchor: anchorOf(m),
      attachment: attachmentOf(m.attachment),
    })),
    nextCursor: rows.length > MESSAGE_PAGE_SIZE && last ? encode(last) : null,
  };
}

export type MessageSentHook = (
  tx: TenantTx,
  message: { id: string; threadId: string; clientId: string; fromClient: boolean },
  now: Date,
) => Promise<void>;

/**
 * Posts a message (S4-4). Idempotent on `clientMessageId` (a retried send returns the stored message). Archived
 * clients' threads are read-only. The recipient gets an email only when they opted in, and it never carries the
 * body (D-007). The audit row holds ids only.
 */
export async function sendMessage(
  tx: TenantTx,
  actor: ActorContext,
  threadId: string,
  /** `anchor` (PRD H3): `{ type: 'session' | 'checkin', id }` of this thread's client. */
  input: {
    body?: unknown;
    clientMessageId?: unknown;
    anchor?: unknown;
    attachmentMediaId?: unknown;
  },
  opts: { now?: Date; requestId?: string; onSent?: MessageSentHook } = {},
): Promise<MessageView> {
  assertCan(actor, 'message:send');
  const thread = await threadFor(tx, actor, threadId);
  if (thread.client.status === 'archived') {
    throw new DomainError('CONFLICT', 'This conversation is closed.');
  }
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const attaching = input.attachmentMediaId !== undefined && input.attachmentMediaId !== null;
  // PRD H2: a photo or PDF may go on its own.
  if (body.length < 1 && !attaching) throw invalid('body', 'Write a message.');
  if (body.length > MESSAGE_MAX) throw invalid('body', `Use at most ${MESSAGE_MAX} characters.`);
  const key = input.clientMessageId;
  if (key !== undefined && (typeof key !== 'string' || !isUuid(key))) {
    throw invalid('clientMessageId', 'Invalid id.');
  }
  const now = opts.now ?? new Date();
  const anchor =
    input.anchor === undefined || input.anchor === null
      ? null
      : await resolveAnchor(
          tx,
          thread.clientId,
          input.anchor as { type?: unknown; id?: unknown },
          now,
        );
  const select = {
    id: true,
    threadId: true,
    senderUserId: true,
    body: true,
    createdAt: true,
    readAt: true,
    anchorType: true,
    anchorId: true,
    anchorLabel: true,
    attachment: { select: { id: true, contentType: true } },
    sender: { select: { name: true } },
  } as const;
  if (typeof key === 'string') {
    const existing = await tx.message.findFirst({
      where: { threadId: thread.id, clientMessageId: key },
      select,
    });
    if (existing) {
      return {
        ...existing,
        senderName: existing.sender.name,
        mine: existing.senderUserId === actor.userId,
        createdAt: existing.createdAt.toISOString(),
        readAt: existing.readAt?.toISOString() ?? null,
        anchor: anchorOf(existing),
        attachment: attachmentOf(existing.attachment),
      };
    }
  }
  const data = {
    threadId: thread.id,
    senderUserId: actor.userId,
    body,
    clientMessageId: typeof key === 'string' ? key : null,
    createdAt: now,
    ...(anchor ? { anchorType: anchor.type, anchorId: anchor.id, anchorLabel: anchor.label } : {}),
    ...(attaching
      ? {
          attachmentMediaId: await ownMedia(
            tx,
            actor,
            input.attachmentMediaId,
            'message',
            thread.clientId,
          ),
        }
      : {}),
  };
  let row;
  if (typeof key === 'string') {
    // ON CONFLICT DO NOTHING on (thread, clientMessageId): two concurrent sends of one key store one message, and
    // the second returns it instead of a unique-violation 500 (PR #2 review B M-4).
    const { count } = await tx.message.createMany({ data: [data] as never, skipDuplicates: true });
    row = await tx.message.findFirstOrThrow({
      where: { threadId: thread.id, clientMessageId: key },
      select,
    });
    if (count === 0) {
      return {
        ...row,
        senderName: row.sender.name,
        mine: row.senderUserId === actor.userId,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
        anchor: anchorOf(row),
        attachment: attachmentOf(row.attachment),
      };
    }
  } else {
    row = await tx.message.create({ data: data as never, select });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'message',
    objectId: row.id,
    action: 'message.sent',
    requestId: opts.requestId,
  });

  const fromClient = actor.role === 'client';
  const recipientId = fromClient ? thread.coachUserId : thread.client.userId;
  if (recipientId) {
    if (await wantsMessageEmail(tx, recipientId)) {
      await enqueueEmail(tx, {
        kind: 'new_message',
        toUserId: recipientId,
        templateKey: 'new_message',
        // Never the body (S4-4): only who wrote.
        payload: { senderName: row.sender.name, toPortal: !fromClient },
        idempotencyKey: `new-message:${row.id}`,
      });
    }
    // PRD H11: a push to each of the recipient's devices that turned notifications on (no content).
    await enqueuePush(tx, {
      toUserId: recipientId,
      kind: 'new_message',
      idempotencyKey: `new-message:${row.id}`,
    });
  }
  await opts.onSent?.(
    tx,
    { id: row.id, threadId: thread.id, clientId: thread.clientId, fromClient },
    now,
  );
  return {
    id: row.id,
    threadId: row.threadId,
    senderUserId: row.senderUserId,
    senderName: row.sender.name,
    mine: true,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    readAt: null,
    anchor: anchorOf(row),
    attachment: attachmentOf(row.attachment),
  };
}

/** The most results one message search returns, newest first. */
export const MESSAGE_SEARCH_LIMIT = 50;

export interface MessageSearchHit {
  messageId: string;
  threadId: string;
  clientName: string;
  senderName: string;
  mine: boolean;
  body: string;
  createdAt: string;
}

/**
 * Searches message text (PRD H17), case-insensitively, newest first (at most 50). A coach searches every thread in
 * the organization; a client only their own. Searching never marks anything read. Results are UI-only: never logged,
 * audited or tracked (D-007).
 */
export async function searchMessages(
  tx: TenantTx,
  actor: ActorContext,
  query: { q?: unknown },
): Promise<MessageSearchHit[]> {
  assertCan(actor, 'message:read');
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q.length < 2 || q.length > 100) throw invalid('q', 'Use 2-100 characters.');
  const scope =
    actor.role === 'client'
      ? { thread: { is: { clientId: actor.clientId ?? '00000000-0000-0000-0000-000000000000' } } }
      : {};
  const rows = await tx.message.findMany({
    where: { ...scope, body: { contains: escapeLike(q), mode: 'insensitive' } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MESSAGE_SEARCH_LIMIT,
    select: {
      id: true,
      threadId: true,
      senderUserId: true,
      body: true,
      createdAt: true,
      sender: { select: { name: true } },
      thread: { select: { client: { select: { name: true } } } },
    },
  });
  return rows.map((m) => ({
    messageId: m.id,
    threadId: m.threadId,
    clientName: m.thread.client.name,
    senderName: m.sender.name,
    mine: m.senderUserId === actor.userId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));
}

const attachmentOf = (a: { id: string; contentType: string } | null | undefined) =>
  a ? { mediaId: a.id, contentType: a.contentType } : null;
