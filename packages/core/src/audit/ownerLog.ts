import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

/**
 * PRD A14: the owner's audit log, content-free: who did what and when (assignments, client changes, exports and
 * deletions, support access, sign-ins revoked), never message text, notes or answers. Newest first, 50 a page.
 */
export const AUDIT_CATEGORIES = [
  'all',
  'assignments',
  'clients',
  'programs',
  'data',
  'access',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export const AUDIT_PAGE_SIZE = 50;

const PREFIXES: Record<Exclude<AuditCategory, 'all'>, string[]> = {
  assignments: ['assignment.', 'form.sent'],
  clients: ['client.', 'invite.', 'join_link.', 'client_tag.'],
  programs: ['program.', 'exercise.', 'checkin_template.'],
  data: ['export.', 'deletion.'],
  access: ['support.', 'session.revoked', 'settings.updated', 'organization.'],
};

/** Readable names for the actions the log shows; anything else shows its code. */
const LABEL: Record<string, string> = {
  'assignment.created': 'Assigned a program',
  'assignment.replaced': 'Replaced a program',
  'client.created': 'Added a client',
  'client.updated': 'Changed a client',
  'client.paused': 'Paused a client',
  'client.resumed': 'Resumed a client',
  'client.joined_by_link': 'A client joined by link',
  'invite.issued': 'Sent an invite',
  'invite.accepted': 'Accepted an invite',
  'invite.revoked': 'Revoked an invite',
  'join_link.created': 'Made a sign-up link',
  'join_link.revoked': 'Turned off a sign-up link',
  'program.created': 'Created a program',
  'program.version_committed': 'Saved a program version',
  'program.duplicated': 'Duplicated a program',
  'export.requested': 'Requested an export',
  'export.built': 'Export ready',
  'deletion.requested': 'Requested a deletion',
  'deletion.completed': 'Deleted client data',
  'support.granted': 'Granted support access',
  'support.revoked': 'Revoked support access',
  'support.client_read': 'Support viewed a client',
  'support.account_lookup': 'Support looked up an account',
  'session.revoked_all': 'Signed out all devices',
  'session.revoked_one': 'Signed out a device',
  'settings.updated': 'Changed settings',
  'organization.updated': 'Changed the workspace',
  'organization.branding_updated': 'Changed branding',
  'form.sent': 'Sent a form',
};

export interface AuditEntry {
  id: string;
  at: string;
  /** The person who acted; null for the system (worker jobs). */
  actorName: string | null;
  action: string;
  label: string;
  objectType: string;
  /** The client the event concerns, when it names one. */
  clientName: string | null;
}

const decodeCursor = (c: string | undefined) => {
  if (!c) return null;
  const [at, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const d = new Date(at ?? '');
  return id && isUuid(id) && !Number.isNaN(d.getTime()) ? { at: d, id } : null;
};

export async function listAuditLog(
  tx: TenantTx,
  actor: ActorContext,
  query: { category?: unknown; cursor?: string } = {},
): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
  if (actor.role !== 'owner')
    throw new DomainError('FORBIDDEN', 'Only the workspace owner can see this.');
  const category = (AUDIT_CATEGORIES as readonly unknown[]).includes(query.category)
    ? (query.category as AuditCategory)
    : 'all';
  const cursor = decodeCursor(query.cursor);
  const and: Record<string, unknown>[] = [];
  if (category !== 'all') {
    and.push({
      OR: PREFIXES[category].map((p) =>
        p.endsWith('.') ? { action: { startsWith: p } } : { action: p },
      ),
    });
  } else {
    // Everyday activity (each message, set or note) isn't an owner's audit concern.
    and.push({
      OR: Object.values(PREFIXES)
        .flat()
        .map((p) => (p.endsWith('.') ? { action: { startsWith: p } } : { action: p })),
    });
  }
  if (cursor) {
    and.push({
      OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
    });
  }
  const rows = await tx.auditEvent.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: AUDIT_PAGE_SIZE + 1,
    select: {
      id: true,
      createdAt: true,
      actorId: true,
      action: true,
      objectType: true,
      objectId: true,
      metadataJson: true,
    },
  });
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const clientIdOf = (r: (typeof page)[number]) => {
    const m = r.metadataJson as { clientId?: unknown } | null;
    if (typeof m?.clientId === 'string' && isUuid(m.clientId)) return m.clientId;
    return r.objectType === 'client' && isUuid(r.objectId) ? r.objectId : null;
  };
  const actorIds = [...new Set(page.map((r) => r.actorId).filter((x): x is string => !!x))];
  const clientIds = [...new Set(page.map(clientIdOf).filter((x): x is string => !!x))];
  const users = actorIds.length
    ? await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const clients = clientIds.length
    ? await tx.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true },
      })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const last = page[page.length - 1];
  return {
    items: page.map((r) => {
      const cid = clientIdOf(r);
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        actorName: r.actorId ? (userName.get(r.actorId) ?? 'Former member') : null,
        action: r.action,
        label: LABEL[r.action] ?? r.action,
        objectType: r.objectType,
        clientName: cid ? (clientName.get(cid) ?? null) : null,
      };
    }),
    nextCursor:
      rows.length > AUDIT_PAGE_SIZE && last
        ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64url')
        : null,
  };
}
