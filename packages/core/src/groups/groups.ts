import { appendAudit, type TenantTx } from '@kinetic/db';
import { isCoachRole, type ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

/**
 * PRD H7, H8: coach-moderated groups. Each group has a chat (short messages in order) and a feed (posts with comments
 * and reactions). Clients see the groups they are in; coaches see all of them. Members can report a post or comment
 * and mute another member; coaches hide anything and settle reports. Clients show as first name and initial.
 */
export const REACTIONS = ['like', 'clap', 'strong', 'fire'] as const;
export type Reaction = (typeof REACTIONS)[number];
export const GROUPS_MAX = 50;
export const GROUP_MEMBERS_MAX = 500;
export type GroupItemKind = 'chat' | 'post';

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  members: number;
  openReports: number;
}

export interface GroupComment {
  id: string;
  author: string;
  authorUserId: string;
  mine: boolean;
  byCoach: boolean;
  body: string;
  createdAt: string;
  hidden: boolean;
}

export interface GroupItem extends GroupComment {
  reactions: { kind: Reaction; count: number; mine: boolean }[];
  comments: GroupComment[];
}

export interface GroupReportView {
  id: string;
  what: 'post' | 'comment';
  itemId: string;
  body: string;
  author: string;
  reason: string;
  createdAt: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  description: string;
  members: { clientId: string; name: string; userId: string | null }[];
  items: GroupItem[];
  /** Coaches only. */
  reports: GroupReportView[];
  /** People the viewer has muted (user ids). */
  muted: string[];
  isCoach: boolean;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** "Ana Silva" -> "Ana S." (a client's name as other members see it). */
export function displayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Member';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts.at(-1)![0]!.toUpperCase()}.`;
}

/** Who the actor is in the group: a coach (any staff) or a member client. NOT_FOUND otherwise. */
async function access(tx: TenantTx, actor: ActorContext, groupId: unknown) {
  if (!isUuid(groupId)) throw notFound();
  const group = await tx.group.findFirst({
    where: { id: groupId, archivedAt: null },
    select: { id: true, name: true, description: true },
  });
  if (!group) throw notFound();
  if (isCoachRole(actor.role)) return { group, coach: true, clientId: null as string | null };
  if (actor.role !== 'client' || !actor.clientId) throw notFound();
  const member = await tx.groupMember.count({
    where: { groupId: group.id, clientId: actor.clientId },
  });
  if (!member) throw notFound();
  return { group, coach: false, clientId: actor.clientId };
}

export async function listGroups(tx: TenantTx, actor: ActorContext): Promise<GroupSummary[]> {
  assertCan(actor, 'message:read');
  const where =
    actor.role === 'client'
      ? { archivedAt: null, members: { some: { clientId: actor.clientId ?? '' } } }
      : { archivedAt: null };
  const rows = await tx.group.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      _count: { select: { members: true, reports: { where: { resolvedAt: null } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    members: r._count.members,
    openReports: actor.role === 'client' ? 0 : r._count.reports,
  }));
}

/** Creates a group, or renames one when `input.id` is set. */
export async function saveGroup(
  tx: TenantTx,
  actor: ActorContext,
  input: { id?: unknown; name?: unknown; description?: unknown },
  opts: { requestId?: string } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'client:update');
  const name = text(input.name);
  if (name.length < 1 || name.length > 80) throw invalid('name', 'Use 1-80 characters.');
  const description = text(input.description);
  if (description.length > 1000) throw invalid('description', 'Use at most 1000 characters.');
  let id: string;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const { count } = await tx.group.updateMany({
      where: { id: input.id, archivedAt: null },
      data: { name, description },
    });
    if (count === 0) throw notFound();
    id = input.id;
  } else {
    if ((await tx.group.count({ where: { archivedAt: null } })) >= GROUPS_MAX) {
      throw invalid('name', `A workspace can have at most ${GROUPS_MAX} groups.`);
    }
    const row = await tx.group.create({
      data: { name, description, createdBy: actor.userId },
      select: { id: true },
    } as Parameters<typeof tx.group.create>[0]);
    id = (row as { id: string }).id;
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'group',
    objectId: id,
    action: input.id === undefined ? 'group.created' : 'group.updated',
    requestId: opts.requestId,
  });
  return { id };
}

export async function archiveGroup(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.group.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'group',
    objectId: id,
    action: 'group.archived',
    requestId: opts.requestId,
  });
}

/** Replaces the group's members. Only active or invited clients can join. */
export async function setGroupMembers(
  tx: TenantTx,
  actor: ActorContext,
  groupId: string,
  clientIds: unknown,
  opts: { requestId?: string } = {},
): Promise<{ members: number }> {
  assertCan(actor, 'client:update');
  const { group } = await access(tx, actor, groupId);
  if (!Array.isArray(clientIds) || !clientIds.every((c) => isUuid(c))) {
    throw invalid('clientIds', 'Pick clients.');
  }
  const ids = [...new Set((clientIds as string[]).map((c) => c.toLowerCase()))];
  if (ids.length > GROUP_MEMBERS_MAX) {
    throw invalid('clientIds', `A group can have at most ${GROUP_MEMBERS_MAX} members.`);
  }
  const found = await tx.client.count({
    where: { id: { in: ids }, status: { in: ['active', 'invited'] } },
  });
  if (found !== ids.length) throw invalid('clientIds', 'One of these clients was not found.');
  await tx.groupMember.deleteMany({ where: { groupId: group.id, clientId: { notIn: ids } } });
  if (ids.length) {
    await tx.groupMember.createMany({
      data: ids.map((clientId) => ({ groupId: group.id, clientId })) as never,
      skipDuplicates: true,
    });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'group',
    objectId: group.id,
    action: 'group.members_set',
    metadata: { members: ids.length },
    requestId: opts.requestId,
  });
  return { members: ids.length };
}

const ITEM_LIMIT: Record<GroupItemKind, number> = { chat: 100, post: 30 };

/** The group's chat (oldest to newest, the latest 100) or feed (newest 30 posts with comments). */
export async function getGroup(
  tx: TenantTx,
  actor: ActorContext,
  groupId: string,
  kind: GroupItemKind,
): Promise<GroupDetail> {
  assertCan(actor, 'message:read');
  const { group, coach } = await access(tx, actor, groupId);
  const muted = (
    await tx.groupMute.findMany({ where: { userId: actor.userId }, select: { mutedUserId: true } })
  ).map((m) => m.mutedUserId);
  const mutedSet = new Set(muted);
  const members = await tx.groupMember.findMany({
    where: { groupId: group.id },
    select: { client: { select: { id: true, name: true, userId: true } } },
  });
  const shown = (hiddenAt: Date | null, authorUserId: string) =>
    (coach || hiddenAt === null) && !mutedSet.has(authorUserId);
  const rows = await tx.groupPost.findMany({
    where: { groupId: group.id, kind, ...(coach ? {} : { hiddenAt: null }) },
    orderBy: { createdAt: 'desc' },
    take: ITEM_LIMIT[kind],
    select: {
      id: true,
      body: true,
      createdAt: true,
      hiddenAt: true,
      authorUserId: true,
      author: { select: { name: true } },
      authorClient: { select: { name: true } },
      reactions: { select: { kind: true, userId: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: {
          id: true,
          body: true,
          createdAt: true,
          hiddenAt: true,
          authorUserId: true,
          author: { select: { name: true } },
          authorClient: { select: { name: true } },
        },
      },
    },
  });
  const who = (r: { authorClient: { name: string } | null; author: { name: string } }) =>
    r.authorClient ? displayName(r.authorClient.name) : r.author.name;
  const base = (r: {
    id: string;
    body: string;
    createdAt: Date;
    hiddenAt: Date | null;
    authorUserId: string;
    authorClient: { name: string } | null;
    author: { name: string };
  }): GroupComment => ({
    id: r.id,
    author: who(r),
    authorUserId: r.authorUserId,
    mine: r.authorUserId === actor.userId,
    byCoach: r.authorClient === null,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    hidden: r.hiddenAt !== null,
  });
  const items = rows
    .filter((r) => shown(r.hiddenAt, r.authorUserId))
    .map((r) => ({
      ...base(r),
      reactions: REACTIONS.map((k) => ({
        kind: k,
        count: r.reactions.filter((x) => x.kind === k).length,
        mine: r.reactions.some((x) => x.kind === k && x.userId === actor.userId),
      })),
      comments: r.comments.filter((c) => shown(c.hiddenAt, c.authorUserId)).map(base),
    }));
  if (kind === 'chat') items.reverse();

  let reports: GroupReportView[] = [];
  if (coach) {
    const open = await tx.groupReport.findMany({
      where: { groupId: group.id, resolvedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        reason: true,
        createdAt: true,
        post: {
          select: {
            id: true,
            body: true,
            author: { select: { name: true } },
            authorClient: { select: { name: true } },
          },
        },
        comment: {
          select: {
            id: true,
            body: true,
            author: { select: { name: true } },
            authorClient: { select: { name: true } },
          },
        },
      },
    });
    reports = open.flatMap((r) => {
      const item = r.post ?? r.comment;
      if (!item) return [];
      return [
        {
          id: r.id,
          what: r.post ? ('post' as const) : ('comment' as const),
          itemId: item.id,
          body: item.body,
          author: who(item),
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
        },
      ];
    });
  }
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    members: members
      .map((m) => ({
        clientId: m.client.id,
        userId: m.client.userId,
        name: coach ? m.client.name : displayName(m.client.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    items,
    reports,
    muted,
    isCoach: coach,
  };
}

/** Writes a chat message or a feed post. */
export async function postToGroup(
  tx: TenantTx,
  actor: ActorContext,
  groupId: string,
  input: { kind?: unknown; body?: unknown },
  opts: { now?: Date } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'message:send');
  const { group, clientId } = await access(tx, actor, groupId);
  if (input.kind !== 'chat' && input.kind !== 'post') throw invalid('kind', 'Pick chat or post.');
  const body = text(input.body);
  if (body.length < 1 || body.length > 4000) throw invalid('body', 'Write 1-4000 characters.');
  const row = await tx.groupPost.create({
    data: {
      groupId: group.id,
      kind: input.kind,
      authorUserId: actor.userId,
      authorClientId: clientId,
      body,
      ...(opts.now ? { createdAt: opts.now } : {}),
    },
    select: { id: true },
  } as Parameters<typeof tx.groupPost.create>[0]);
  return { id: (row as { id: string }).id };
}

async function postFor(tx: TenantTx, actor: ActorContext, postId: unknown) {
  if (!isUuid(postId)) throw notFound();
  const post = await tx.groupPost.findFirst({
    where: { id: postId },
    select: { id: true, groupId: true, kind: true, hiddenAt: true },
  });
  if (!post) throw notFound();
  const a = await access(tx, actor, post.groupId);
  if (post.hiddenAt && !a.coach) throw notFound();
  return { post, ...a };
}

export async function commentOnPost(
  tx: TenantTx,
  actor: ActorContext,
  postId: string,
  input: { body?: unknown },
): Promise<{ id: string }> {
  assertCan(actor, 'message:send');
  const { post, clientId } = await postFor(tx, actor, postId);
  if (post.kind !== 'post') throw invalid('body', 'Reply in the chat instead.');
  const body = text(input.body);
  if (body.length < 1 || body.length > 2000) throw invalid('body', 'Write 1-2000 characters.');
  const row = await tx.groupComment.create({
    data: { postId: post.id, authorUserId: actor.userId, authorClientId: clientId, body },
    select: { id: true },
  } as Parameters<typeof tx.groupComment.create>[0]);
  return { id: (row as { id: string }).id };
}

/** Adds or removes the actor's reaction. */
export async function reactToPost(
  tx: TenantTx,
  actor: ActorContext,
  postId: string,
  input: { kind?: unknown; on?: unknown },
): Promise<void> {
  assertCan(actor, 'message:send');
  const { post } = await postFor(tx, actor, postId);
  if (!(REACTIONS as readonly unknown[]).includes(input.kind))
    throw invalid('kind', 'Pick a reaction.');
  const kind = input.kind as Reaction;
  if (input.on === false) {
    await tx.groupReaction.deleteMany({ where: { postId: post.id, userId: actor.userId, kind } });
    return;
  }
  await tx.groupReaction.createMany({
    data: [{ postId: post.id, userId: actor.userId, kind }] as never,
    skipDuplicates: true,
  });
}

/** A member reports a post or comment to the coaches. */
export async function reportGroupItem(
  tx: TenantTx,
  actor: ActorContext,
  input: { postId?: unknown; commentId?: unknown; reason?: unknown },
): Promise<void> {
  assertCan(actor, 'message:send');
  const reason = text(input.reason).slice(0, 500);
  let groupId: string;
  let postId: string | null = null;
  let commentId: string | null = null;
  if (input.commentId !== undefined) {
    if (!isUuid(input.commentId)) throw notFound();
    const c = await tx.groupComment.findFirst({
      where: { id: input.commentId, hiddenAt: null },
      select: { id: true, post: { select: { groupId: true } } },
    });
    if (!c) throw notFound();
    groupId = c.post.groupId;
    commentId = c.id;
  } else {
    if (!isUuid(input.postId)) throw notFound();
    const p = await tx.groupPost.findFirst({
      where: { id: input.postId, hiddenAt: null },
      select: { id: true, groupId: true },
    });
    if (!p) throw notFound();
    groupId = p.groupId;
    postId = p.id;
  }
  const { clientId } = await access(tx, actor, groupId);
  const already = await tx.groupReport.count({
    where: { reporterUserId: actor.userId, postId, commentId, resolvedAt: null },
  });
  if (already) return;
  await tx.groupReport.create({
    data: {
      groupId,
      postId,
      commentId,
      reporterUserId: actor.userId,
      reporterClientId: clientId,
      reason,
    },
  } as Parameters<typeof tx.groupReport.create>[0]);
}

/** A coach hides a post or comment (from everyone but coaches) and settles its reports; `hidden: false` restores it. */
export async function moderateGroupItem(
  tx: TenantTx,
  actor: ActorContext,
  input: { postId?: unknown; commentId?: unknown; hidden?: unknown },
  opts: { requestId?: string; now?: Date } = {},
): Promise<void> {
  assertCan(actor, 'review:update');
  const now = opts.now ?? new Date();
  const hiddenAt = input.hidden === false ? null : now;
  let groupId: string;
  let where: { postId: string } | { commentId: string };
  if (input.commentId !== undefined) {
    if (!isUuid(input.commentId)) throw notFound();
    const c = await tx.groupComment.findFirst({
      where: { id: input.commentId },
      select: { id: true, post: { select: { groupId: true } } },
    });
    if (!c) throw notFound();
    await tx.groupComment.update({ where: { id: c.id }, data: { hiddenAt } });
    groupId = c.post.groupId;
    where = { commentId: c.id };
  } else {
    if (!isUuid(input.postId)) throw notFound();
    const p = await tx.groupPost.findFirst({
      where: { id: input.postId },
      select: { id: true, groupId: true },
    });
    if (!p) throw notFound();
    await tx.groupPost.update({ where: { id: p.id }, data: { hiddenAt } });
    groupId = p.groupId;
    where = { postId: p.id };
  }
  if (hiddenAt) {
    await tx.groupReport.updateMany({
      where: { ...where, resolvedAt: null },
      data: { resolvedAt: now },
    });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'group',
    objectId: groupId,
    action: hiddenAt ? 'group.item_hidden' : 'group.item_restored',
    metadata: where,
    requestId: opts.requestId,
  });
}

/** A coach closes a report without hiding anything. */
export async function dismissGroupReport(
  tx: TenantTx,
  actor: ActorContext,
  reportId: string,
): Promise<void> {
  assertCan(actor, 'review:update');
  if (!isUuid(reportId)) throw notFound();
  const { count } = await tx.groupReport.updateMany({
    where: { id: reportId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  if (count === 0) throw notFound();
}

/** Mutes (or unmutes) another client across the workspace's groups. Coaches can't be muted. */
export async function muteMember(
  tx: TenantTx,
  actor: ActorContext,
  mutedUserId: string,
  on: boolean,
): Promise<void> {
  assertCan(actor, 'message:send');
  if (!isUuid(mutedUserId) || mutedUserId === actor.userId) throw notFound();
  if (!on) {
    await tx.groupMute.deleteMany({ where: { userId: actor.userId, mutedUserId } });
    return;
  }
  const isClient = await tx.client.count({ where: { userId: mutedUserId } });
  if (!isClient) throw notFound();
  await tx.groupMute.createMany({
    data: [{ userId: actor.userId, mutedUserId }] as never,
    skipDuplicates: true,
  });
}
