import { appendAudit, type TenantTx } from '@repsy/db';
import { emitClientEvent } from '../automations/events';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

export const TAG_COLORS = ['teal', 'blue', 'purple', 'orange', 'red', 'gray'] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_NAME_MAX = 40;
export const TAGS_MAX = 50;
export const TAGS_PER_CLIENT_MAX = 10;

export interface TagView {
  id: string;
  name: string;
  color: TagColor;
}

export interface TagWithCount extends TagView {
  /** Clients carrying the tag, archived ones included. */
  clientCount: number;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

/** The organization's tags (PRD B4), by name, with how many clients carry each. */
export async function listTags(tx: TenantTx, actor: ActorContext): Promise<TagWithCount[]> {
  assertCan(actor, 'client:read');
  const rows = await tx.clientTag.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, color: true, _count: { select: { links: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, clientCount: r._count.links }));
}

/** Creates a tag (PRD B4). Names are unique per organization, ignoring case. */
export async function createTag(
  tx: TenantTx,
  actor: ActorContext,
  input: { name?: unknown; color?: unknown },
  opts: { requestId?: string } = {},
): Promise<TagView> {
  assertCan(actor, 'client:update');
  const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 1 || name.length > TAG_NAME_MAX) {
    throw invalid('name', `Use 1-${TAG_NAME_MAX} characters.`);
  }
  const color = input.color === undefined ? 'teal' : input.color;
  if (!TAG_COLORS.includes(color as TagColor)) throw invalid('color', 'Choose a colour.');
  const existing = await tx.clientTag.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) throw invalid('name', 'A tag with this name already exists.');
  if ((await tx.clientTag.count()) >= TAGS_MAX) {
    throw invalid('name', `Use at most ${TAGS_MAX} tags.`);
  }
  const row = await tx.clientTag.create({
    data: { name, color: color as TagColor } as Parameters<typeof tx.clientTag.create>[0]['data'],
    select: { id: true, name: true, color: true },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client_tag',
    objectId: row.id,
    action: 'client_tag.created',
    requestId: opts.requestId,
  });
  return row;
}

/** Deletes a tag and removes it from every client (PRD B4). */
export async function deleteTag(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw notFound();
  const tag = await tx.clientTag.findFirst({ where: { id }, select: { id: true } });
  if (!tag) throw notFound();
  await tx.clientTagLink.deleteMany({ where: { tagId: tag.id } });
  // Resources shared with this tag only (PRD G5) go with it.
  await tx.resource.deleteMany({ where: { tagId: tag.id } });
  await tx.clientTag.delete({ where: { id: tag.id } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client_tag',
    objectId: tag.id,
    action: 'client_tag.deleted',
    requestId: opts.requestId,
  });
}

/** Replaces a client's tags with `tagIds` (PRD B4). Unknown or other organizations' tags are a validation error. */
export async function setClientTags(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  tagIds: unknown,
): Promise<TagView[]> {
  assertCan(actor, 'client:update');
  if (!isUuid(clientId)) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, organizationId: true },
  });
  if (!client) throw notFound();
  if (!Array.isArray(tagIds) || !tagIds.every((t) => typeof t === 'string' && isUuid(t))) {
    throw invalid('tagIds', 'Use a list of tag ids.');
  }
  const ids = [...new Set((tagIds as string[]).map((t) => t.toLowerCase()))];
  if (ids.length > TAGS_PER_CLIENT_MAX) {
    throw invalid('tagIds', `Use at most ${TAGS_PER_CLIENT_MAX} tags per client.`);
  }
  const tags = await tx.clientTag.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, color: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  if (tags.length !== ids.length) throw invalid('tagIds', 'One of these tags no longer exists.');
  const before = new Set(
    (
      await tx.clientTagLink.findMany({ where: { clientId: client.id }, select: { tagId: true } })
    ).map((l) => l.tagId),
  );
  await tx.clientTagLink.deleteMany({ where: { clientId: client.id, tagId: { notIn: ids } } });
  // PRD J2: automations triggered by a tag.
  for (const tagId of ids.filter((t) => !before.has(t))) {
    await emitClientEvent(tx, client.id, 'tag_added', { tagId });
  }
  if (ids.length > 0) {
    await tx.clientTagLink.createMany({
      data: ids.map((tagId) => ({
        organizationId: client.organizationId,
        clientId: client.id,
        tagId,
      })),
      skipDuplicates: true,
    });
  }
  return tags;
}

/** At most this many clients per bulk action (PRD B5). */
export const BULK_MAX_CLIENTS = 200;

/**
 * Adds one tag to many clients at once (PRD B5): each client gets their own link; existing tags stay. Clients already
 * at the per-client tag limit are skipped and counted.
 */
export async function addTagToClients(
  tx: TenantTx,
  actor: ActorContext,
  tagId: unknown,
  clientIds: unknown,
  opts: { requestId?: string } = {},
): Promise<{ tagged: number; skipped: number }> {
  assertCan(actor, 'client:update');
  if (!isUuid(tagId)) throw invalid('tagId', 'Pick a tag.');
  if (
    !Array.isArray(clientIds) ||
    clientIds.length === 0 ||
    !clientIds.every((c) => typeof c === 'string' && isUuid(c))
  ) {
    throw invalid('clientIds', 'Pick at least one client.');
  }
  const ids = [...new Set((clientIds as string[]).map((c) => c.toLowerCase()))];
  if (ids.length > BULK_MAX_CLIENTS) {
    throw invalid('clientIds', `Pick at most ${BULK_MAX_CLIENTS} clients at once.`);
  }
  const tag = await tx.clientTag.findFirst({ where: { id: tagId }, select: { id: true } });
  if (!tag) throw invalid('tagId', 'This tag no longer exists.');
  const clients = await tx.client.findMany({
    where: { id: { in: ids } },
    select: { id: true, organizationId: true, _count: { select: { tagLinks: true } } },
  });
  if (clients.length !== ids.length)
    throw invalid('clientIds', 'One of these clients was not found.');
  const already = new Set(
    (
      await tx.clientTagLink.findMany({
        where: { tagId: tag.id, clientId: { in: ids } },
        select: { clientId: true },
      })
    ).map((l) => l.clientId),
  );
  const room = clients.filter((c) => already.has(c.id) || c._count.tagLinks < TAGS_PER_CLIENT_MAX);
  const fresh = room.filter((c) => !already.has(c.id));
  if (fresh.length > 0) {
    await tx.clientTagLink.createMany({
      data: fresh.map((c) => ({ organizationId: c.organizationId, clientId: c.id, tagId: tag.id })),
      skipDuplicates: true,
    });
    for (const c of fresh) await emitClientEvent(tx, c.id, 'tag_added', { tagId: tag.id });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client_tag',
    objectId: tag.id,
    action: 'client_tag.bulk_added',
    metadata: { clients: fresh.length },
    requestId: opts.requestId,
  });
  return { tagged: room.length, skipped: clients.length - room.length };
}

/** Tags per client id, by name (for lists and profiles). */
export async function tagsForClients(
  tx: TenantTx,
  actor: ActorContext,
  clientIds: readonly string[],
): Promise<Map<string, TagView[]>> {
  assertCan(actor, 'client:read');
  const out = new Map<string, TagView[]>();
  if (clientIds.length === 0) return out;
  const links = await tx.clientTagLink.findMany({
    where: { clientId: { in: [...clientIds] } },
    select: { clientId: true, tag: { select: { id: true, name: true, color: true } } },
    orderBy: [{ tag: { name: 'asc' } }],
  });
  for (const l of links) {
    const list = out.get(l.clientId) ?? [];
    list.push(l.tag);
    out.set(l.clientId, list);
  }
  return out;
}
