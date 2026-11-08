import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

export const REPLY_TARGETS = [4, 12, 24, 48, 72] as const;
export const OFFICE_HOURS_MAX = 200;
export const SAVED_REPLY_TITLE_MAX = 60;
export const SAVED_REPLY_BODY_MAX = 2000;
export const SAVED_REPLIES_MAX = 100;

export interface ReplyExpectations {
  /** Usual reply time in hours, or null when not set. */
  replyTargetHours: number | null;
  officeHours: string | null;
}

export interface SavedReplyView {
  id: string;
  title: string;
  body: string;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

/** The workspace's reply expectations (PRD H16); clients read them on their Messages page. */
export async function getReplyExpectations(
  tx: TenantTx,
  actor: ActorContext,
): Promise<ReplyExpectations> {
  assertCan(actor, 'message:read');
  const org = await tx.organization.findFirst({
    where: { id: actor.orgId },
    select: { replyTargetHours: true, officeHours: true },
  });
  return { replyTargetHours: org?.replyTargetHours ?? null, officeHours: org?.officeHours ?? null };
}

/** Sets the usual reply time (4, 12, 24, 48 or 72 hours, or null) and office hours text (PRD H16). Owner only. */
export async function updateReplyExpectations(
  tx: TenantTx,
  actor: ActorContext,
  input: { replyTargetHours?: unknown; officeHours?: unknown },
  opts: { requestId?: string } = {},
): Promise<ReplyExpectations> {
  assertCan(actor, 'settings:org:update');
  const data: { replyTargetHours?: number | null; officeHours?: string | null } = {};
  if (input.replyTargetHours !== undefined) {
    const v = input.replyTargetHours;
    if (v !== null && !REPLY_TARGETS.includes(v as (typeof REPLY_TARGETS)[number])) {
      throw invalid('replyTargetHours', 'Choose 4, 12, 24, 48 or 72 hours.');
    }
    data.replyTargetHours = v as number | null;
  }
  if (input.officeHours !== undefined) {
    const v = input.officeHours;
    if (v !== null && typeof v !== 'string') throw invalid('officeHours', 'Use text.');
    const text = (v ?? '').trim();
    if (text.length > OFFICE_HOURS_MAX) {
      throw invalid('officeHours', `Use at most ${OFFICE_HOURS_MAX} characters.`);
    }
    data.officeHours = text || null;
  }
  if (Object.keys(data).length > 0) {
    await tx.organization.update({ where: { id: actor.orgId }, data });
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'organization',
      objectId: actor.orgId,
      action: 'organization.reply_expectations_updated',
      requestId: opts.requestId,
    });
  }
  return getReplyExpectations(tx, actor);
}

/** The workspace's saved replies, by title (PRD H4). Coaches only. */
export async function listSavedReplies(
  tx: TenantTx,
  actor: ActorContext,
): Promise<SavedReplyView[]> {
  assertCan(actor, 'note:read');
  return tx.savedReply.findMany({
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, body: true },
  });
}

export async function createSavedReply(
  tx: TenantTx,
  actor: ActorContext,
  input: { title?: unknown; body?: unknown },
): Promise<SavedReplyView> {
  assertCan(actor, 'note:write');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (title.length < 1 || title.length > SAVED_REPLY_TITLE_MAX) {
    throw invalid('title', `Use 1-${SAVED_REPLY_TITLE_MAX} characters.`);
  }
  if (body.length < 1 || body.length > SAVED_REPLY_BODY_MAX) {
    throw invalid('body', `Use 1-${SAVED_REPLY_BODY_MAX} characters.`);
  }
  if ((await tx.savedReply.count()) >= SAVED_REPLIES_MAX) {
    throw invalid('title', `Use at most ${SAVED_REPLIES_MAX} saved replies.`);
  }
  return tx.savedReply.create({
    data: { title, body, createdByUserId: actor.userId } as Parameters<
      typeof tx.savedReply.create
    >[0]['data'],
    select: { id: true, title: true, body: true },
  });
}

export async function deleteSavedReply(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
): Promise<void> {
  assertCan(actor, 'note:write');
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.savedReply.deleteMany({ where: { id } });
  if (count === 0) throw notFound();
}

/** Fills `{first_name}` with the client's first name (the whole name when it has one word). */
export function fillSavedReply(body: string, clientName: string): string {
  const first = clientName.trim().split(/\s+/)[0] || clientName;
  return body.replace(/\{first_name\}/g, first);
}
