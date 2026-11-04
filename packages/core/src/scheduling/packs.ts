import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

/**
 * PRD K11: in-person credit packs (for example 10 sessions) that bookings use
 * up; the balance is shown to the client. A pack belongs to one client in one
 * organization. Only the balance arithmetic is pure; purchase/consume/list
 * below run against the `session_packs` table (migration
 * 20260101000088_scheduling_domains). The Prisma client in this copy does not
 * yet have that model (schema.prisma is untouched by this slice), so the
 * transaction is used through the structural `PacksDb` delegate below; after
 * the parent merges SCHEMA_SNIPPET_SCHEDULING.md and regenerates the client,
 * the delegate can be replaced with the typed `tx.sessionPack` calls.
 */
export type PackStatus = 'active' | 'exhausted' | 'expired';

export interface PackView {
  id: string;
  clientId: string;
  name: string;
  totalSessions: number;
  usedSessions: number;
  /** Sessions left. Never negative. */
  remaining: number;
  expiresAt: string | null;
  status: PackStatus;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

/** Pure: sessions left, clamped at zero. */
export function packBalance(totalSessions: number, usedSessions: number): number {
  return Math.max(0, totalSessions - usedSessions);
}

/** Pure: whether a pack may still be spent at `now`. */
export function isPackUsable(
  pack: { totalSessions: number; usedSessions: number; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (packBalance(pack.totalSessions, pack.usedSessions) <= 0) return false;
  if (pack.expiresAt !== null && pack.expiresAt <= now) return false;
  return true;
}

/** Pure: the status a pack row shows, from its counts and expiry. */
export function packStatusOf(
  pack: { totalSessions: number; usedSessions: number; expiresAt: Date | null },
  now: Date = new Date(),
): PackStatus {
  if (pack.expiresAt !== null && pack.expiresAt <= now) return 'expired';
  if (packBalance(pack.totalSessions, pack.usedSessions) <= 0) return 'exhausted';
  return 'active';
}

export function toPackView(row: {
  id: string;
  clientId: string;
  name: string;
  totalSessions: number;
  usedSessions: number;
  expiresAt: Date | null;
  now?: Date;
}): PackView {
  const now = row.now ?? new Date();
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    totalSessions: row.totalSessions,
    usedSessions: row.usedSessions,
    remaining: packBalance(row.totalSessions, row.usedSessions),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    status: packStatusOf(row, now),
  };
}

/** Structural delegate for the not-yet-generated `session_packs` model. */
export interface PacksDb {
  sessionPack: {
    findFirst(args: unknown): Promise<{
      id: string;
      clientId: string;
      name: string;
      totalSessions: number;
      usedSessions: number;
      expiresAt: Date | null;
    } | null>;
    findMany(args: unknown): Promise<
      {
        id: string;
        clientId: string;
        name: string;
        totalSessions: number;
        usedSessions: number;
        expiresAt: Date | null;
      }[]
    >;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
}

const db = (tx: TenantTx): PacksDb => tx as unknown as PacksDb;

function cleanName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (name.length < 1 || name.length > 120) throw invalid('name', 'Use 1-120 characters.');
  return name;
}

/** A coach records a pack purchase for a client. No payment is taken here; billing (K1-K9) owns money. */
export async function purchasePack(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { now?: Date } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'client:update');
  const now = opts.now ?? new Date();
  if (!isUuid(input.clientId)) throw notFound();
  const client = await (
    tx as TenantTx & { client: { findFirst(a: unknown): Promise<unknown> } }
  ).client.findFirst({ where: { id: input.clientId }, select: { id: true } });
  if (!client) throw notFound();
  const name = cleanName(input.name);
  const total = Number(input.totalSessions);
  if (!Number.isInteger(total) || total < 1 || total > 500) {
    throw invalid('totalSessions', 'Use 1-500 sessions.');
  }
  let expiresAt: Date | null = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
    expiresAt = new Date(input.expiresAt as string);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      throw invalid('expiresAt', 'Pick a future expiry, or leave it blank.');
    }
  }
  const row = await db(tx).sessionPack.create({
    data: {
      clientId: input.clientId,
      name,
      totalSessions: total,
      usedSessions: 0,
      expiresAt,
      status: 'active',
    },
    select: { id: true },
  });
  return { id: row.id };
}

/**
 * Spends one credit from a pack. Throws VALIDATION when the pack is used up or
 * expired, NOT_FOUND when it is not this client's pack. Idempotent per booking
 * only through the caller: a booking records `packConsumed` (see scheduling.ts)
 * so a retry of the same booking never debits twice.
 */
export async function consumePackCredit(
  tx: TenantTx,
  packId: string,
  clientId: string,
  opts: { now?: Date } = {},
): Promise<PackView> {
  const now = opts.now ?? new Date();
  const pack = await db(tx).sessionPack.findFirst({
    where: { id: packId, clientId },
    select: {
      id: true,
      clientId: true,
      name: true,
      totalSessions: true,
      usedSessions: true,
      expiresAt: true,
    },
  });
  if (!pack) throw notFound();
  if (!isPackUsable(pack, now)) {
    throw invalid('packId', 'That pack has no sessions left, or it has expired.');
  }
  const usedSessions = pack.usedSessions + 1;
  await db(tx).sessionPack.update({
    where: { id: pack.id },
    data: {
      usedSessions,
      status: packBalance(pack.totalSessions, usedSessions) <= 0 ? 'exhausted' : 'active',
    },
  });
  return toPackView({ ...pack, usedSessions, now });
}

/** Returns one credit when a pack-funded booking is cancelled. */
export async function refundPackCredit(
  tx: TenantTx,
  packId: string,
  clientId: string,
): Promise<PackView | null> {
  const pack = await db(tx).sessionPack.findFirst({
    where: { id: packId, clientId },
    select: {
      id: true,
      clientId: true,
      name: true,
      totalSessions: true,
      usedSessions: true,
      expiresAt: true,
    },
  });
  if (!pack || pack.usedSessions <= 0) return pack ? toPackView(pack) : null;
  const usedSessions = pack.usedSessions - 1;
  await db(tx).sessionPack.update({
    where: { id: pack.id },
    data: { usedSessions, status: 'active' },
  });
  return toPackView({ ...pack, usedSessions });
}

/** Packs for one client, most recently purchased first. Clients see only their own (core scopes by actor.clientId). */
export async function listPacks(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<PackView[]> {
  assertCan(actor, 'session:read');
  if (actor.role === 'client' && actor.clientId !== clientId) {
    throw new DomainError('FORBIDDEN', 'You do not have access to this.');
  }
  if (!isUuid(clientId)) throw notFound();
  const rows = await db(tx).sessionPack.findMany({
    where: { clientId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      clientId: true,
      name: true,
      totalSessions: true,
      usedSessions: true,
      expiresAt: true,
    },
  });
  return rows.map((r) => toPackView(r));
}
