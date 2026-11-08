import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

export const RESOURCE_TITLE_MAX = 120;
export const RESOURCE_BODY_MAX = 4000;
export const RESOURCE_URL_MAX = 500;
export const RESOURCES_MAX = 300;

export type ResourceAudience = 'all' | 'tag' | 'client';

export interface ResourceView {
  id: string;
  title: string;
  url: string | null;
  body: string | null;
  audience: ResourceAudience;
  /** Coaches only: who it is shared with, in words ("All clients", "Tag: Online", "Ana Silva"). */
  sharedWith: string | null;
  createdAt: string;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

const SELECT = {
  id: true,
  title: true,
  url: true,
  body: true,
  audience: true,
  createdAt: true,
  tag: { select: { name: true } },
  client: { select: { name: true } },
} as const;

/**
 * The resource library (PRD G5). Coaches see every active resource with who it is shared with; a client sees what is
 * shared with all clients, with one of their tags, or with them, newest first.
 */
export async function listResources(tx: TenantTx, actor: ActorContext): Promise<ResourceView[]> {
  assertCan(actor, 'session:read');
  let where: Record<string, unknown> = { archivedAt: null };
  if (actor.role === 'client') {
    if (!actor.clientId) throw notFound();
    const tags = await tx.clientTagLink.findMany({
      where: { clientId: actor.clientId },
      select: { tagId: true },
    });
    where = {
      archivedAt: null,
      OR: [
        { audience: 'all' },
        { audience: 'tag', tagId: { in: tags.map((t) => t.tagId) } },
        { audience: 'client', clientId: actor.clientId },
      ],
    };
  }
  const rows = await tx.resource.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: SELECT,
  });
  const coach = actor.role !== 'client';
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    body: r.body,
    audience: r.audience as ResourceAudience,
    sharedWith: !coach
      ? null
      : r.audience === 'all'
        ? 'All clients'
        : r.audience === 'tag'
          ? `Tag: ${r.tag?.name ?? ''}`
          : (r.client?.name ?? 'One client'),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createResource(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    title?: unknown;
    url?: unknown;
    body?: unknown;
    audience?: unknown;
    tagId?: unknown;
    clientId?: unknown;
  },
  opts: { requestId?: string } = {},
): Promise<ResourceView> {
  assertCan(actor, 'client:update');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1 || title.length > RESOURCE_TITLE_MAX) {
    throw invalid('title', `Use 1-${RESOURCE_TITLE_MAX} characters.`);
  }
  const url = typeof input.url === 'string' && input.url.trim() !== '' ? input.url.trim() : null;
  if (url !== null) {
    let ok = false;
    try {
      ok = new URL(url).protocol === 'https:' && url.length <= RESOURCE_URL_MAX;
    } catch {
      ok = false;
    }
    if (!ok) throw invalid('url', 'Use a full https:// link.');
  }
  const body =
    typeof input.body === 'string' && input.body.trim() !== '' ? input.body.trim() : null;
  if (body !== null && body.length > RESOURCE_BODY_MAX) {
    throw invalid('body', `Use at most ${RESOURCE_BODY_MAX} characters.`);
  }
  if (url === null && body === null) throw invalid('url', 'Add a link or some text.');
  const audience = input.audience;
  let tagId: string | null = null;
  let clientId: string | null = null;
  if (audience === 'tag') {
    if (!isUuid(input.tagId)) throw invalid('tagId', 'Pick a tag.');
    const tag = await tx.clientTag.findFirst({ where: { id: input.tagId }, select: { id: true } });
    if (!tag) throw invalid('tagId', 'Pick a tag.');
    tagId = tag.id;
  } else if (audience === 'client') {
    if (!isUuid(input.clientId)) throw invalid('clientId', 'Pick a client.');
    const client = await tx.client.findFirst({
      where: { id: input.clientId },
      select: { id: true },
    });
    if (!client) throw invalid('clientId', 'Pick a client.');
    clientId = client.id;
  } else if (audience !== 'all') {
    throw invalid('audience', 'Pick who can see it.');
  }
  if ((await tx.resource.count({ where: { archivedAt: null } })) >= RESOURCES_MAX) {
    throw invalid(
      'title',
      `A workspace can have at most ${RESOURCES_MAX} resources. Remove some first.`,
    );
  }
  const row = await tx.resource.create({
    data: { title, url, body, audience, tagId, clientId, createdByUserId: actor.userId },
    select: { id: true },
  } as Parameters<typeof tx.resource.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'resource',
    objectId: (row as { id: string }).id,
    action: 'resource.created',
    metadata: { audience: audience as string },
    requestId: opts.requestId,
  });
  return (await listResources(tx, actor)).find((r) => r.id === (row as { id: string }).id)!;
}

/** Removes a resource from everyone's library (kept archived, never shown again). */
export async function archiveResource(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.resource.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'resource',
    objectId: id,
    action: 'resource.archived',
    requestId: opts.requestId,
  });
}
