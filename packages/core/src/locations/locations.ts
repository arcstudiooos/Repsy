import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

/**
 * PRD A15: locations for studios with several sites. A client trains at one location; a staff
 * member can be tied to one (null = every site). Managers add, rename and archive locations;
 * archiving keeps history but hides the location from pickers.
 */
export interface LocationView {
  id: string;
  name: string;
  address: string | null;
  archived: boolean;
  clientCount: number;
  staffCount: number;
}

const notFound = () => new DomainError('NOT_FOUND', 'Location not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export async function listLocations(
  tx: TenantTx,
  actor: ActorContext,
  opts: { includeArchived?: boolean } = {},
): Promise<LocationView[]> {
  assertCan(actor, 'org:read');
  const rows = await tx.location.findMany({
    where: { organizationId: actor.orgId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      address: true,
      archivedAt: true,
      _count: {
        select: {
          clients: { where: { status: { not: 'archived' } } },
          memberships: { where: { status: 'active' } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    archived: r.archivedAt !== null,
    clientCount: r._count.clients,
    staffCount: r._count.memberships,
  }));
}

/** Creates a location, or renames one when `id` is given. Managers only. */
export async function saveLocation(
  tx: TenantTx,
  actor: ActorContext,
  input: { id?: string; name: string; address?: string | null },
): Promise<{ id: string }> {
  assertCan(actor, 'location:manage');
  const name = input.name.trim();
  if (!name || name.length > 80) throw invalid('name', 'Use 1-80 characters.');
  const address = input.address?.trim() || null;
  if (address && address.length > 300) throw invalid('address', 'Use up to 300 characters.');
  if (input.id) {
    if (!isUuid(input.id)) throw notFound();
    const { count } = await tx.location.updateMany({
      where: { id: input.id, organizationId: actor.orgId },
      data: { name, address },
    });
    if (count === 0) throw notFound();
    return { id: input.id };
  }
  const active = await tx.location.count({
    where: { organizationId: actor.orgId, archivedAt: null },
  });
  if (active >= 50) throw invalid('name', 'A workspace can have up to 50 locations.');
  const row = await tx.location.create({
    data: { organizationId: actor.orgId, name, address },
    select: { id: true },
  });
  return row;
}

/** Archives (or restores) a location. Clients and staff keep it for history. */
export async function setLocationArchived(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  archived: boolean,
): Promise<{ archived: boolean }> {
  assertCan(actor, 'location:manage');
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.location.updateMany({
    where: { id, organizationId: actor.orgId },
    data: { archivedAt: archived ? new Date() : null },
  });
  if (count === 0) throw notFound();
  return { archived };
}

async function assertActiveLocation(tx: TenantTx, actor: ActorContext, locationId: string | null) {
  if (locationId === null) return;
  if (!isUuid(locationId)) throw invalid('locationId', 'Pick a location.');
  const found = await tx.location.findFirst({
    where: { id: locationId, organizationId: actor.orgId, archivedAt: null },
    select: { id: true },
  });
  if (!found) throw invalid('locationId', 'Pick a location.');
}

/** Sets the location a client trains at (null to clear). Trainers. */
export async function setClientLocation(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  locationId: string | null,
): Promise<{ locationId: string | null }> {
  assertCan(actor, 'client:update');
  if (!isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Client not found.');
  await assertActiveLocation(tx, actor, locationId);
  const { count } = await tx.client.updateMany({
    where: { id: clientId, organizationId: actor.orgId },
    data: { locationId },
  });
  if (count === 0) throw new DomainError('NOT_FOUND', 'Client not found.');
  return { locationId };
}

/** Ties a staff member to a location (null = every site). Managers. */
export async function setStaffLocation(
  tx: TenantTx,
  actor: ActorContext,
  userId: string,
  locationId: string | null,
): Promise<{ locationId: string | null }> {
  assertCan(actor, 'location:manage');
  if (!isUuid(userId)) throw new DomainError('NOT_FOUND', 'Team member not found.');
  await assertActiveLocation(tx, actor, locationId);
  const { count } = await tx.membership.updateMany({
    where: {
      userId,
      organizationId: actor.orgId,
      status: 'active',
      role: { in: ['owner', 'admin', 'coach', 'assistant'] },
    },
    data: { locationId },
  });
  if (count === 0) throw new DomainError('NOT_FOUND', 'Team member not found.');
  return { locationId };
}

export interface LocationStaffView {
  userId: string;
  name: string;
  role: string;
  locationId: string | null;
}

/** Staff and the location each is tied to, for the Locations page. */
export async function listStaffLocations(
  tx: TenantTx,
  actor: ActorContext,
): Promise<LocationStaffView[]> {
  assertCan(actor, 'location:manage');
  const rows = await tx.membership.findMany({
    where: {
      organizationId: actor.orgId,
      status: 'active',
      role: { in: ['owner', 'admin', 'coach', 'assistant'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { userId: true, role: true, locationId: true, user: { select: { name: true } } },
  });
  const seen = new Set<string>();
  return rows
    .filter((r) => (seen.has(r.userId) ? false : (seen.add(r.userId), true)))
    .map((r) => ({
      userId: r.userId,
      name: r.user.name ?? 'Team member',
      role: r.role,
      locationId: r.locationId,
    }));
}
