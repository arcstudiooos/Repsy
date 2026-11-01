import type { TenantTx } from '@kinetic/db';
import { effectiveStage, LIFECYCLE_STAGES, stageWhere, type LifecycleStage } from './stage';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { summarizeInvites, type InviteStatus } from '../invites/invites';
import { decodeCursor, encodeCursor, PAGE_SIZE } from '../pagination';
import { canonicalTimezone } from '../timezone';
import { isUuid } from '../uuid';
import { closePauseOnArchive, toPauseView, type PauseView } from './pause';

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
  /** The open pause (S3-5); null when the program is not paused. */
  pause: PauseView | null;
  /** ISO weekday of the weekly check-in (S4-1); null = no check-ins. */
  checkinWeekday: number | null;
  /** PRD F4: every 1, 2 or 4 weeks. */
  checkinEveryWeeks: number;
  /** PRD F2: the client's recurring template; null = the default. */
  checkinTemplateId: string | null;
  /** PRD B20. */
  lifecycleStage: LifecycleStage;
  /** PRD A11: the primary coach. */
  coachUserId: string;
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
  checkinWeekday: number | null;
  checkinEveryWeeks: number;
  checkinTemplateId: string | null;
  lifecycleStage: string;
  coachUserId: string;
  createdAt: Date;
}

export const NAME_MAX = 120;
export const GOALS_MAX = 2000;
export const QUERY_MAX = 100;

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Statuses that occupy a slot under `Organization.activeClientLimit`. A pause is temporary (at most 90 days) and ends
 * on its own without a limit check, so a paused client keeps their slot.
 */
export const COUNTED: ClientStatus[] = ['invited', 'active', 'paused'];

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export interface InviteSummary {
  status: InviteStatus;
  expiresAt: Date | null;
  acceptedAt: Date | null;
}

const NO_INVITE: InviteSummary = { status: 'none', expiresAt: null, acceptedAt: null };

export function toClientView(
  row: ClientRow,
  invite: InviteSummary = NO_INVITE,
  pause: { startLocalDate: Date; resumeLocalDate: Date } | null = null,
): ClientView {
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
    pause: pause ? toPauseView(pause) : null,
    checkinWeekday: row.checkinWeekday,
    checkinEveryWeeks: row.checkinEveryWeeks,
    checkinTemplateId: row.checkinTemplateId,
    lifecycleStage: effectiveStage(row),
    coachUserId: row.coachUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function cleanName(name: string): string {
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
export function lockOrganization(tx: TenantTx, actor: ActorContext) {
  return tx.organization.update({
    where: { id: actor.orgId },
    data: { updatedAt: new Date() },
    select: { timezone: true, activeClientLimit: true, trialEndsAt: true },
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
      undefined,
      { limit },
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

/** Open pauses per client (S3-5). */
async function openPauses(tx: TenantTx, ids: string[]) {
  if (ids.length === 0) return new Map<string, { startLocalDate: Date; resumeLocalDate: Date }>();
  const rows = await tx.clientPause.findMany({
    where: { clientId: { in: ids }, endedAt: null },
    select: { clientId: true, startLocalDate: true, resumeLocalDate: true },
  });
  return new Map(rows.map((r) => [r.clientId, r]));
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
  // PRD A4: an ended trial keeps its clients but takes no new ones.
  if (org.trialEndsAt && org.trialEndsAt <= new Date()) {
    throw new DomainError(
      'TRIAL_ENDED',
      'Your free trial has ended. Your clients and data are kept; contact us to continue.',
    );
  }
  await assertUnderLimit(tx, org.activeClientLimit);
  if (await tx.client.findFirst({ where: { email }, select: { id: true } })) {
    throw new DomainError('EMAIL_TAKEN', 'A client with this email already exists.');
  }
  // Scalar FKs only: the tenant extension injects scalar organizationId, which
  // Prisma rejects next to a relation connect.
  const row = await tx.client.create({
    // Canonical even when the org row predates canonicalization.
    data: {
      coachUserId: actor.userId,
      name,
      email,
      goals,
      timezone: canonicalTimezone(org.timezone) ?? org.timezone,
    },
  } as Parameters<typeof tx.client.create>[0]);
  return toClientView(row);
}

export async function listClients(
  tx: TenantTx,
  actor: ActorContext,
  query: {
    q?: string;
    status?: ClientStatus;
    cursor?: string;
    tagId?: string;
    /** PRD B20. */
    stage?: LifecycleStage;
    /** PRD A12: only clients of these primary coaches ("My clients"). */
    coachUserIds?: string[];
  },
): Promise<{ items: ClientView[]; nextCursor: string | null }> {
  assertCan(actor, 'client:read');
  const and: Record<string, unknown>[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.stage && (LIFECYCLE_STAGES as readonly string[]).includes(query.stage)) {
    and.push(stageWhere(query.stage));
  }
  if (query.coachUserIds) and.push({ coachUserId: { in: query.coachUserIds } });
  if (query.tagId !== undefined) {
    if (!isUuid(query.tagId)) throw invalid('tagId', 'Use a tag id.');
    and.push({ tagLinks: { some: { tagId: query.tagId } } });
  }
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
  const pauses = await openPauses(
    tx,
    page.map((row) => row.id),
  );
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toClientView(row, statuses.get(row.id), pauses.get(row.id) ?? null)),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

export async function getClient(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
): Promise<ClientView> {
  assertCan(actor, 'client:read');
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const row = await tx.client.findFirst({ where: { id } });
  if (!row) throw new DomainError('NOT_FOUND', 'Not found.');
  const invite = (await inviteStatuses(tx, [row.id])).get(row.id);
  return toClientView(row, invite, (await openPauses(tx, [row.id])).get(row.id) ?? null);
}

const LABEL: Record<ClientStatus, string> = {
  invited: 'invited',
  active: 'active',
  paused: 'paused',
  archived: 'archived',
};

/**
 * Coach-driven status changes (a client becomes `active` only by accepting an invite, never by a PATCH):
 * invited -> archived; active <-> paused; active|paused -> archived; archived -> active only for a client that has
 * accepted (linked user), otherwise a restore goes back to invited. Asking for the current status is a no-op.
 * Everything else is CONFLICT.
 */
export function nextClientStatus(
  from: ClientStatus,
  requested: ClientStatus,
  hasUser: boolean,
): ClientStatus {
  if (from === requested) return from;
  if (from === 'archived') {
    if (requested === 'active') return hasUser ? 'active' : 'invited';
    if (requested === 'invited' && !hasUser) return 'invited';
  } else if (requested === 'archived') {
    return 'archived';
  } else if (
    (from === 'active' && requested === 'paused') ||
    (from === 'paused' && requested === 'active')
  ) {
    return requested;
  }
  const hint =
    from === 'invited' && (requested === 'active' || requested === 'paused')
      ? ' The client becomes active when they accept their invite.'
      : '';
  throw new DomainError(
    'CONFLICT',
    `A client can't move from ${LABEL[from]} to ${LABEL[requested]}.${hint}`,
  );
}

const STATUSES: ClientStatus[] = ['invited', 'active', 'paused', 'archived'];

export async function updateClient(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  patch: {
    name?: string;
    goals?: string | null;
    status?: ClientStatus;
    startDate?: string | null;
  },
): Promise<ClientView> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const data: {
    name?: string;
    goals?: string | null;
    status?: ClientStatus;
    startDate?: Date | null;
  } = {};
  if (patch.name !== undefined) data.name = cleanName(patch.name);
  if (patch.goals !== undefined) data.goals = cleanGoals(patch.goals);
  if (patch.status !== undefined && !STATUSES.includes(patch.status)) {
    throw invalid('status', 'Invalid status.');
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

  // Any change that can land in a counted status takes the org lock before reading the client, so the limit check
  // and the write are serialized with every other create/activation in this organization.
  const mayCount = patch.status === 'active' || patch.status === 'invited';
  const org = mayCount ? await lockOrganization(tx, actor) : undefined;
  const current = await tx.client.findFirst({
    where: { id },
    select: { status: true, userId: true },
  });
  if (!current) throw new DomainError('NOT_FOUND', 'Not found.');
  // An erased client (S5-3) stays as an anonymized row only: editing or re-inviting it would attach a new person to
  // the erased client's history (PR #2 review C M-9).
  const erased = await tx.deletionRequest.findFirst({
    where: { subjectClientId: id, status: { in: ['processing', 'done'] } },
    select: { id: true },
  });
  if (erased)
    throw new DomainError('CONFLICT', "This client's data was deleted. Add them as a new client.");
  if (patch.status !== undefined) {
    // Ruling 6: pausing and resuming move sessions, so they go through the pause API only.
    const intoPause = current.status === 'active' && patch.status === 'paused';
    const outOfPause = current.status === 'paused' && patch.status === 'active';
    if (intoPause || outOfPause) throw invalid('status', 'Use Pause program to pause or resume.');
    const next = nextClientStatus(current.status, patch.status, current.userId !== null);
    if (org && COUNTED.includes(next) && !COUNTED.includes(current.status)) {
      await assertUnderLimit(tx, org.activeClientLimit);
    }
    data.status = next;
  }
  // The client row first, then the pause row: the same lock order as the pause operations.
  const row = await tx.client.update({ where: { id }, data });
  if (data.status === 'archived' && current.status !== 'archived') {
    await closePauseOnArchive(tx, id, new Date());
  }
  const invite = (await inviteStatuses(tx, [row.id])).get(row.id);
  return toClientView(row, invite, (await openPauses(tx, [row.id])).get(row.id) ?? null);
}
