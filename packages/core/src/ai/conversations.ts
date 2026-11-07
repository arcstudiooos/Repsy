import { withSystem, type PrismaClient, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';

/** PRD I15: conversations are kept this long after their last message, then purged by the worker. */
export const AI_CONVERSATION_RETENTION_DAYS = 90;
/** Longest question a coach can send in one turn. */
export const AI_MESSAGE_MAX_CHARS = 4000;

export interface AiConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface AiMessageView {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  toolsUsed: string[];
  createdAt: string;
}

export interface AiConversationView extends AiConversationSummary {
  messages: AiMessageView[];
}

const notFound = () => new DomainError('NOT_FOUND', 'Conversation not found.');

/** The actor's own conversations, newest first. Other staff never see them. */
export async function listAiConversations(
  tx: TenantTx,
  actor: ActorContext,
): Promise<AiConversationSummary[]> {
  assertCan(actor, 'assistant:use');
  const rows = await tx.aiConversation.findMany({
    where: { organizationId: actor.orgId, userId: actor.userId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }));
}

export async function getAiConversation(
  tx: TenantTx,
  actor: ActorContext,
  conversationId: string,
): Promise<AiConversationView> {
  assertCan(actor, 'assistant:use');
  const row = await tx.aiConversation.findFirst({
    where: { id: conversationId, organizationId: actor.orgId, userId: actor.userId },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, body: true, toolsUsed: true, createdAt: true },
      },
    },
  });
  if (!row) throw notFound();
  return {
    id: row.id,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    messages: row.messages.map((m) => ({
      id: m.id,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      body: m.body,
      toolsUsed: m.toolsUsed,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/** A short title from the first question. */
export function conversationTitle(question: string): string {
  const oneLine = question.replace(/\s+/g, ' ').trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine || 'New conversation';
}

export function cleanQuestion(question: string): string {
  const q = question.trim();
  if (!q) throw new DomainError('VALIDATION', 'Type a question first.');
  if (q.length > AI_MESSAGE_MAX_CHARS) {
    throw new DomainError('VALIDATION', `Keep questions under ${AI_MESSAGE_MAX_CHARS} characters.`);
  }
  return q;
}

/** Starts a conversation for the actor and returns its id. */
export async function createAiConversation(
  tx: TenantTx,
  actor: ActorContext,
  firstQuestion: string,
): Promise<string> {
  assertCan(actor, 'assistant:use');
  const row = await tx.aiConversation.create({
    data: {
      organizationId: actor.orgId,
      userId: actor.userId,
      title: conversationTitle(firstQuestion),
    },
    select: { id: true },
  });
  return row.id;
}

/** Appends one finished exchange (the question and the answer) to the actor's conversation. */
export async function appendAiExchange(
  tx: TenantTx,
  actor: ActorContext,
  conversationId: string,
  exchange: { question: string; answer: string; toolsUsed: string[] },
): Promise<AiMessageView[]> {
  assertCan(actor, 'assistant:use');
  const owned = await tx.aiConversation.findFirst({
    where: { id: conversationId, organizationId: actor.orgId, userId: actor.userId },
    select: { id: true },
  });
  if (!owned) throw notFound();
  const now = Date.now();
  const user = await tx.aiMessage.create({
    data: {
      organizationId: actor.orgId,
      conversationId,
      role: 'user',
      body: exchange.question,
      createdAt: new Date(now),
    },
  });
  const assistant = await tx.aiMessage.create({
    data: {
      organizationId: actor.orgId,
      conversationId,
      role: 'assistant',
      body: exchange.answer,
      toolsUsed: [...new Set(exchange.toolsUsed)],
      createdAt: new Date(now + 1),
    },
  });
  await tx.aiConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date(now + 1) },
  });
  return [user, assistant].map((m) => ({
    id: m.id,
    role: m.role === 'assistant' ? 'assistant' : 'user',
    body: m.body,
    toolsUsed: m.toolsUsed,
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function deleteAiConversation(
  tx: TenantTx,
  actor: ActorContext,
  conversationId: string,
): Promise<{ deleted: true }> {
  assertCan(actor, 'assistant:use');
  const result = await tx.aiConversation.deleteMany({
    where: { id: conversationId, organizationId: actor.orgId, userId: actor.userId },
  });
  if (result.count === 0) throw notFound();
  return { deleted: true };
}

/**
 * Worker sweep: deletes conversations untouched for `AI_CONVERSATION_RETENTION_DAYS`, across every
 * workspace (system scope, like the other purge jobs). Messages go with them (ON DELETE CASCADE).
 */
export async function purgeOldAiConversations(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - AI_CONVERSATION_RETENTION_DAYS * 86_400_000);
  const { count } = await withSystem(
    (tx) => tx.aiConversation.deleteMany({ where: { updatedAt: { lt: cutoff } } }),
    prisma,
  );
  return { purged: count };
}
