import { randomBytes } from 'node:crypto';
import {
  appendAudit,
  withSystem,
  withTenant,
  type PrismaClient,
  type SystemTx,
  type TenantTx,
} from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';

/**
 * PRD L4 (D-013 #15): custom domains and branded sending. A workspace adds a hostname, proves it with a TXT record
 * at `_repsy.<host>` (checked by a worker sweep), then points a CNAME at the app. Only its public page and storefront
 * are served there. Once verified, the domain is registered with the email provider; when the provider's DNS
 * records verify too, the workspace's emails come from that domain.
 */
const invalid = (message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { hostname: [message] });

export interface DnsPort {
  /**
   * TXT records at `name` (each record's strings joined). Throws `DnsNoRecord` when DNS answered that there are
   * none, and any other error when the lookup itself failed.
   */
  txt(name: string): Promise<string[]>;
}

export interface SendingDomainRecord {
  type: string;
  name: string;
  value: string;
}

export interface MailDomainPort {
  create(hostname: string): Promise<{ ref: string; records: SendingDomainRecord[] }>;
  status(ref: string): Promise<'pending' | 'verified' | 'failed'>;
  /** Releases the domain at the provider (a removed custom domain). */
  remove(ref: string): Promise<void>;
}

export interface CustomDomainView {
  hostname: string;
  status: 'pending' | 'verified' | 'failed';
  /** What to add: a TXT record at `_repsy.<hostname>` with this value, and a CNAME to the app. */
  txtName: string;
  txtValue: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  sendingStatus: 'none' | 'pending' | 'verified' | 'failed';
  sendingRecords: SendingDomainRecord[];
}

const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const txtValueOf = (token: string) => `repsy-verify=${token}`;

/** A bare hostname, lowercased; refuses IPs, ports, paths, wildcards and the app's own domain. */
export function cleanHostname(input: unknown, appHost: string): string {
  if (typeof input !== 'string') throw invalid('Enter a domain like coach.example.com.');
  const host = input.trim().toLowerCase().replace(/\.$/, '');
  if (!HOST.test(host) || host.length > 253) {
    throw invalid('Enter a domain like coach.example.com, without https:// or a path.');
  }
  const app = appHost.toLowerCase();
  if (host === app || host.endsWith(`.${app}`)) throw invalid("That's this app's own domain.");
  return host;
}

const toView = (d: {
  hostname: string;
  status: string;
  verifyToken: string;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  sendingStatus: string;
  sendingRecords: unknown;
}): CustomDomainView => ({
  hostname: d.hostname,
  status: d.status as CustomDomainView['status'],
  txtName: `_repsy.${d.hostname}`,
  txtValue: txtValueOf(d.verifyToken),
  verifiedAt: d.verifiedAt?.toISOString() ?? null,
  lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
  sendingStatus: d.sendingStatus as CustomDomainView['sendingStatus'],
  sendingRecords: Array.isArray(d.sendingRecords)
    ? (d.sendingRecords as SendingDomainRecord[]).slice(0, 20)
    : [],
});

const LIVE = { status: { not: 'removed' } } as const;

export async function getCustomDomain(
  tx: TenantTx,
  actor: ActorContext,
): Promise<CustomDomainView | null> {
  assertCan(actor, 'settings:org:update');
  const d = await tx.customDomain.findFirst({ where: LIVE });
  return d ? toView(d) : null;
}

export async function addCustomDomain(
  tx: TenantTx,
  actor: ActorContext,
  input: { hostname: unknown },
  ctx: { appHost: string; requestId?: string },
): Promise<CustomDomainView> {
  assertCan(actor, 'settings:org:update');
  const hostname = cleanHostname(input.hostname, ctx.appHost);
  if (await tx.customDomain.findFirst({ where: LIVE, select: { id: true } })) {
    throw new DomainError('CONFLICT', 'Remove the current domain first.');
  }
  // Only a verified domain reserves its hostname, so an unproven claim never blocks the real owner (final review
  // #4): proving it with the TXT record decides. One live domain per workspace (partial unique index).
  const created = await tx.customDomain
    .create({
      data: { hostname, verifyToken: randomBytes(16).toString('hex'), createdBy: actor.userId },
    } as Parameters<typeof tx.customDomain.create>[0])
    .catch((e: unknown) => {
      if ((e as { code?: string }).code === 'P2002') {
        throw new DomainError('CONFLICT', 'Remove the current domain first.');
      }
      throw e;
    });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'custom_domain',
    objectId: created.id,
    action: 'custom_domain.added',
    metadata: { hostname },
    requestId: ctx.requestId,
  });
  return toView(created);
}

/**
 * Stops serving and sending at once. A domain registered with the email provider is kept as `removed` until the
 * worker has released it there, so the next owner of the hostname can register it (final review #4).
 */
export async function removeCustomDomain(
  tx: TenantTx,
  actor: ActorContext,
  ctx: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'settings:org:update');
  const d = await tx.customDomain.findFirst({
    where: LIVE,
    select: { id: true, hostname: true, sendingRef: true },
  });
  if (!d) return;
  if (d.sendingRef) {
    await tx.customDomain.updateMany({
      where: { id: d.id },
      data: { status: 'removed', sendingStatus: 'none', lastCheckedAt: null },
    });
  } else {
    await tx.customDomain.deleteMany({ where: { id: d.id } });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'custom_domain',
    objectId: d.id,
    action: 'custom_domain.removed',
    metadata: { hostname: d.hostname },
    requestId: ctx.requestId,
  });
}

/** Ask for a check now (the sweep runs every few minutes; this just makes the next one pick it up). */
export async function recheckCustomDomain(tx: TenantTx, actor: ActorContext): Promise<void> {
  assertCan(actor, 'settings:org:update');
  await tx.customDomain.updateMany({ where: LIVE, data: { lastCheckedAt: null } });
}

// ---------------------------------------------------------------- the worker sweep

const CHECK_EVERY_MS = 5 * 60_000;
/** After this long without the TXT record, an unproven domain shows as failed (it is still checked). */
const GIVE_UP_MS = 7 * 86_400_000;
/** A verified domain is demoted only after this many missing TXT answers in a row (final review #3). */
const MISSES_BEFORE_DEMOTE = 3;

/** DNS answered, and there is no such record (as opposed to a lookup that failed). */
export class DnsNoRecord extends Error {
  constructor() {
    super('No such DNS record');
    this.name = 'DnsNoRecord';
  }
}

/**
 * Checks domains' TXT records, oldest check first, registers verified ones with the email provider and follows
 * that provider's verification, and releases removed ones there. A lookup that fails (timeout, SERVFAIL) changes
 * nothing; a verified domain whose record is missing three times in a row goes back to pending.
 */
export async function sweepCustomDomains(
  prisma: PrismaClient,
  deps: { dns: DnsPort; mail: MailDomainPort | null },
  now: Date = new Date(),
): Promise<{ verified: number; checked: number }> {
  const due = await withSystem(
    (tx) =>
      tx.customDomain.findMany({
        where: {
          OR: [
            { lastCheckedAt: null },
            { lastCheckedAt: { lt: new Date(now.getTime() - CHECK_EVERY_MS) } },
          ],
        },
        orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
        take: 100,
      }),
    prisma,
  );
  let verified = 0;
  for (const d of due) {
    const write = (data: Record<string, unknown>) =>
      withTenant(
        d.organizationId,
        (tx) => tx.customDomain.updateMany({ where: { id: d.id }, data }),
        prisma,
      );
    if (d.status === 'removed') {
      try {
        if (d.sendingRef && deps.mail) await deps.mail.remove(d.sendingRef);
        await withTenant(
          d.organizationId,
          (tx) => tx.customDomain.deleteMany({ where: { id: d.id } }),
          prisma,
        );
      } catch {
        await write({ lastCheckedAt: now });
      }
      continue;
    }
    let records: string[];
    try {
      records = await deps.dns.txt(`_repsy.${d.hostname}`);
    } catch (e) {
      if (!(e instanceof DnsNoRecord)) {
        // The lookup itself failed: say nothing about the domain, look again next time.
        await write({ lastCheckedAt: now });
        continue;
      }
      records = [];
    }
    const proved = records.some((r) => r.trim() === txtValueOf(d.verifyToken));
    const data: Record<string, unknown> = { lastCheckedAt: now };
    if (proved) {
      data.missedChecks = 0;
      if (d.status !== 'verified') {
        data.status = 'verified';
        data.verifiedAt = now;
      }
    } else {
      const misses = d.missedChecks + 1;
      data.missedChecks = misses;
      if (d.status !== 'verified' || misses >= MISSES_BEFORE_DEMOTE) {
        data.status = now.getTime() - d.createdAt.getTime() > GIVE_UP_MS ? 'failed' : 'pending';
      }
    }
    if (proved && deps.mail) {
      try {
        if (d.sendingStatus === 'none') {
          const r = await deps.mail.create(d.hostname);
          data.sendingRef = r.ref;
          data.sendingRecords = r.records.slice(0, 20);
          data.sendingStatus = 'pending';
        } else if (d.sendingStatus === 'pending' && d.sendingRef) {
          data.sendingStatus = await deps.mail.status(d.sendingRef);
        }
      } catch {
        // The provider is down or refused: try again on the next sweep.
      }
    }
    try {
      await write(data);
      if (proved && d.status !== 'verified') verified++;
    } catch (e) {
      // Another workspace proved this hostname first (partial unique index): this claim stays unproven.
      if ((e as { code?: string }).code !== 'P2002') throw e;
      await write({ lastCheckedAt: now, status: 'failed', missedChecks: d.missedChecks });
    }
  }
  return { verified, checked: due.length };
}

// ---------------------------------------------------------------- serving and sending

/**
 * The public page slug a verified custom host serves; `''` for a custom domain that isn't serving (redirect it);
 * null for a host that is no custom domain (security definer lookup, slug only).
 */
export async function publicSlugForHost(
  prisma: PrismaClient,
  host: string,
): Promise<string | null> {
  const h = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!HOST.test(h)) return null;
  const rows = await (prisma as unknown as Pick<SystemTx, '$queryRaw'>).$queryRaw<
    { slug: string | null }[]
  >`SELECT app_public_slug_by_host(${h}) AS slug`;
  return rows[0]?.slug ?? null;
}

/**
 * The From address for a workspace's emails: `"<Workspace>" <hello@domain>` once its domain verifies for sending,
 * else null (the default address). System read, for the email worker.
 */
export async function brandedFromFor(tx: SystemTx, orgId: string): Promise<string | null> {
  const d = await tx.customDomain.findFirst({
    where: { organizationId: orgId, status: 'verified', sendingStatus: 'verified' },
    select: { hostname: true, organization: { select: { name: true } } },
  });
  if (!d) return null;
  // A display name can't break out of its quotes or add headers.
  const name =
    d.organization.name
      .replace(/["\\<>\r\n]/g, '')
      .trim()
      .slice(0, 60) || 'Your coach';
  return `"${name}" <hello@${d.hostname}>`;
}
