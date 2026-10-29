import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { summarizeInvites, type InviteStatus } from '../invites/invites';
import { decodeCursor, encodeCursor, PAGE_SIZE } from '../pagination';

export type ClientStatus = 'invited' | 'active' | 'paused' | 'archived';

export interface ClientView {
  id: string;
  name: string;
  email: string;
  status: ClientStatus;
  startDate: string | null;
  goals: string | null;
  timezone: string;
  preferredUnits: 'kg' | 'lb';
  inviteStatus: InviteStatus;
  /** Expiry of the current (pending or expired) invite; null otherwise. */
  inviteExpiresAt: string | null;
  /** When the client accepted their invite; null if they have not. */
  joinedAt: string | null;
  createdAt: string;
}

interface ClientRow {
  id: string;
  name: string;
  email: string;
  status: ClientStatus;
  startDate: Date | null;
  goals: string | null;
  timezone: string;
  preferredUnits: 'kg' | 'lb';
  createdAt: Date;
}

export const NAME_MAX = 120;
export const GOALS_MAX = 2000;
export const QUERY_MAX = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Statuses that occupy a slot under `Organization.activeClientLimit`. */
const COUNTED: ClientStatus[] = ['invited', 'active'];

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export interface InviteSummary {
  status: InviteStatus;
  expiresAt: Date | null;
  acceptedAt: Date | null;
}

const NO_INVITE: InviteSummary = { status: 'none', expiresAt: null, acceptedAt: null };

export function toClientView(row: ClientRow, invite: InviteSummary = NO_INVITE): ClientView {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    status: row.status,
    startDate: row.startDate ? row.startDate.toISOString().slice(0, 10) : null,
    goals: row.goals,
    timezone: row.timezone,
    preferredUnits: row.preferredUnits,
    inviteStatus: invite.status,
    inviteExpiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
    joinedAt: invite.acceptedAt ? invite.acceptedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function cleanName(name: string): string {
  const v = name.trim();
  if (v.length < 1 || v.length > NAME_MAX) throw invalid('name', `Use 1-${NAME_MAX} characters.`);
  return v;
}

export function cleanGoals(goals: string | null | undefined): string | null {
  if (goals === undefined || goals === null) return null;
  const v = goals.trim();
  if (v.length > GOALS_MAX) throw invalid('goals', `Use at most ${GOALS_MAX} characters.`);
  return v === '' ? null : v;
}

/** Escape LIKE metacharacters so user text matches literally (Prisma passes `contains` through to ILIKE). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Serializes concurrent limit checks: a no-op UPDATE holds the organization row
 * lock until the surrounding tenant transaction commits.
 */
function lockOrganization(tx: TenantTx, actor: ActorContext) {
  return tx.organization.update({
    where: { id: actor.orgId },
    data: { updatedAt: new Date() },
    select: { timezone: true, activeClientLimit: true },
  });
}

/** Clients occupying a slot under `Organization.activeClientLimit` (invited + active). */
export const countActiveClients = (tx: TenantTx): Promise<number> =>
  tx.client.count({ where: { status: { in: COUNTED } } });

async function assertUnderLimit(tx: TenantTx, limit: number) {
  const used = await countActiveClients(tx);
  if (used >= limit) {
    throw new DomainError(
      'CLIENT_LIMIT_REACHED',
      `You have reached your limit of ${limit} active clients.`,
    );
  }
}

/** Coach-facing invite state per client, from the client's invite rows. */
async function inviteStatuses(tx: TenantTx, ids: string[]): Promise<Map<string, InviteSummary>> {
  const out = new Map<string, InviteSummary>();
  if (ids.length === 0) return out;
  const rows = await tx.clientInvite.findMany({
    where: { clientId: { in: ids } },
    select: { clientId: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true },
  });
  const now = new Date();
  for (const id of ids) {
    const mine = rows.filter((x) => x.clientId === id);
    const status = summarizeInvites(mine, now);
    const current = mine
      .filter((x) => !x.revokedAt && !x.acceptedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    out.set(id, {
      status,
      expiresAt: status === 'pending' || status === 'expired' ? (current?.expiresAt ?? null) : null,
      acceptedAt: mine.find((x) => x.acceptedAt)?.acceptedAt ?? null,
    });
  }
  return out;
}

export async function createClient(
  tx: TenantTx,
  actor: ActorContext,
  input: { name: string; email: string; goals?: string },
): Promise<ClientView> {
  assertCan(actor, 'client:create');
  const name = cleanName(input.name);
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw invalid('email', 'Enter a valid email.');
  const goals = cleanGoals(input.goals);

  const org = await lockOrganization(tx, actor);
  await assertUnderLimit(tx, org.activeClientLimit);
  if (await tx.client.findFirst({ where: { email }, select: { id: true } })) {
    throw new DomainError('EMAIL_TAKEN', 'A client with this email already exists.');
  }
  // Scalar FKs only: the tenant extension injects scalar organizationId, which
  // Prisma rejects next to a relation connect.
  const row = await tx.client.create({
    data: { coachUserId: actor.userId, name, email, goals, timezone: org.timezone },
  } as Parameters<typeof tx.client.create>[0]);
  return toClientView(row);
}

export async function listClients(
  tx: TenantTx,
  actor: ActorContext,
  query: { q?: string; status?: ClientStatus; cursor?: string },
): Promise<{ items: ClientView[]; nextCursor: string | null }> {
  assertCan(actor, 'client:read');
  const and: Record<string, unknown>[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.q !== undefined) {
    const q = query.q.trim();
    if (q.length < 1 || q.length > QUERY_MAX) {
      throw invalid('q', `Use 1-${QUERY_MAX} characters.`);
    }
    const contains = { contains: escapeLike(q), mode: 'insensitive' as const };
    and.push({ OR: [{ name: contains }, { email: contains }] });
  }
  if (query.cursor !== undefined) {
    const c = decodeCursor(query.cursor);
    and.push({
      OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }],
    });
  }
  const rows = await tx.client.findMany({
    where: and.length ? { AND: and } : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
  });
  const page = rows.slice(0, PAGE_SIZE);
  const statuses = await inviteStatuses(
    tx,
    page.map((row) => row.id),
  );
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toClientView(row, statuses.get(row.id))),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

export async function getClient(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
): Promise<ClientView> {
  assertCan(actor, 'client:read');
  if (!UUID.test(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const row = await tx.client.findFirst({ where: { id } });
  if (!row) throw new DomainError('NOT_FOUND', 'Not found.');
  return toClientView(row, (await inviteStatuses(tx, [id])).get(id));
}

export async function updateClient(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  patch: {
    name?: string;
    goals?: string | null;
    status?: 'active' | 'paused' | 'archived';
    startDate?: string | null;
  },
): Promise<ClientView> {
  assertCan(actor, 'client:update');
  if (!UUID.test(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const data: {
    name?: string;
    goals?: string | null;
    status?: 'active' | 'paused' | 'archived';
    startDate?: Date | null;
  } = {};
  if (patch.name !== undefined) data.name = cleanName(patch.name);
  if (patch.goals !== undefined) data.goals = cleanGoals(patch.goals);
  if (patch.status !== undefined) {
    if (!['active', 'paused', 'archived'].includes(patch.status)) {
      throw invalid('status', 'Invalid status.');
    }
    data.status = patch.status;
  }
  if (patch.startDate !== undefined) {
    if (patch.startDate === null) {
      data.startDate = null;
    } else {
      const d = new Date(`${patch.startDate}T00:00:00.000Z`);
      if (!DATE.test(patch.startDate) || Number.isNaN(d.getTime())) {
        throw invalid('startDate', 'Use YYYY-MM-DD.');
      }
      data.startDate = d;
    }
  }

  const org = patch.status === 'active' ? await lockOrganization(tx, actor) : undefined;
  const current = await tx.client.findFirst({ where: { id }, select: { status: true } });
  if (!current) throw new DomainError('NOT_FOUND', 'Not found.');
  if (org && !COUNTED.includes(current.status)) await assertUnderLimit(tx, org.activeClientLimit);
  const row = await tx.client.update({ where: { id }, data });
  return toClientView(row, (await inviteStatuses(tx, [id])).get(id));
}
