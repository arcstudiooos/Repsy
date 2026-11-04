import { randomBytes } from 'node:crypto';
import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';

/**
 * PRD L4: a custom domain (coach.example.com) for the portal and join pages,
 * plus branded sending addresses.
 *
 * Verification flow in this slice: the coach requests a domain, the system
 * issues a TXT verification token, and the coach marks the domain verified
 * once they have set the DNS record. Verification is RECORDED, NOT CHECKED:
 * no DNS lookup is performed here (the task forbids DNS lookups, and the
 * server has no DNS client wired for this). A real check — resolving the TXT
 * record and comparing it to the token before flipping `verifiedAt` — is a
 * documented follow-up; until it lands, treat `verified` as coach-attested,
 * not proven. Never use an unverified domain for sending or routing.
 *
 * Routing: `resolveWorkspaceByHost` maps a request hostname to a workspace
 * id from a list of verified domains. It is a pure helper; the parent wires
 * it into middleware (snippet in SLICE_REPORT_SCHEDULING.md) so existing
 * routes keep working and an unknown host falls back to the default host.
 */
export type CustomDomainStatus = 'requested' | 'verified';

export interface CustomDomainView {
  id: string;
  hostname: string;
  status: CustomDomainStatus;
  /** Shown once, to the requesting manager, so they can set the DNS record. */
  verificationToken: string | null;
  verifiedAt: string | null;
  /** Local part of the branded sending address, e.g. `hello` in hello@coach.example.com. */
  brandedFromLocal: string | null;
  brandedFromAddress: string | null;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

/** Pure: lowercase, strip a scheme, a port, a trailing dot, and surrounding spaces. */
export function normalizeHostname(value: unknown): string {
  if (typeof value !== 'string') return '';
  let host = value.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  host = host.split(':')[0] ?? '';
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Pure: a usable custom hostname — at least one dot, valid labels, 253 chars max, no scheme or path. */
export function isValidHostname(hostname: string): boolean {
  if (hostname.length < 4 || hostname.length > 253) return false;
  if (hostname.includes('..') || hostname.includes('_')) return false;
  const labels = hostname.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL.test(l))) return false;
  if (!/[a-z]/.test(labels[labels.length - 1] ?? '')) return false;
  return true;
}

export function cleanHostname(value: unknown): string {
  const host = normalizeHostname(value);
  if (!isValidHostname(host)) {
    throw invalid('hostname', 'Use a domain like coach.example.com (no http://, no path).');
  }
  return host;
}

/** Pure: a 32-hex-character token, rendered as the TXT value. */
export function generateVerificationToken(): string {
  return `kinetic-verify-${randomBytes(16).toString('hex')}`;
}

/** Pure: the DNS record the coach must set. */
export function verificationTxtRecord(
  hostname: string,
  token: string,
): { name: string; value: string } {
  return { name: `_kinetic.${hostname}`, value: token };
}

/** Pure: the branded sending address for a verified domain, or null. */
export function brandedSenderAddress(hostname: string, localPart: string | null): string | null {
  if (!localPart) return null;
  return `${localPart}@${hostname}`;
}

const LOCAL_PART = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function cleanLocalPart(value: unknown): string {
  const local = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!LOCAL_PART.test(local)) {
    throw invalid(
      'brandedFromLocal',
      'Use a sender name like hello or coaching (letters, digits, . _ -).',
    );
  }
  return local;
}

/**
 * Pure hostname routing: an exact match against a VERIFIED domain wins; any
 * other host (including unverified or merely similar domains) returns null
 * so the caller falls back to the default host. Subdomains of a verified
 * domain do NOT match — only the exact hostname the coach verified.
 */
export function resolveWorkspaceByHost(
  host: string,
  domains: { hostname: string; organizationId: string; status: CustomDomainStatus }[],
): string | null {
  const normalized = normalizeHostname(host);
  if (!normalized) return null;
  const hit = domains.find((d) => d.hostname === normalized && d.status === 'verified');
  return hit ? hit.organizationId : null;
}

/** Structural delegate for the not-yet-generated `custom_domains` model. */
export interface DomainsDb {
  customDomain: {
    findFirst(args: unknown): Promise<{
      id: string;
      hostname: string;
      status: string;
      verificationToken: string;
      verifiedAt: Date | null;
      brandedFromLocal: string | null;
    } | null>;
    findMany(args: unknown): Promise<
      {
        id: string;
        hostname: string;
        status: string;
        verificationToken: string;
        verifiedAt: Date | null;
        brandedFromLocal: string | null;
      }[]
    >;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
}

const db = (tx: TenantTx): DomainsDb => tx as unknown as DomainsDb;

function toView(row: {
  id: string;
  hostname: string;
  status: string;
  verificationToken: string;
  verifiedAt: Date | null;
  brandedFromLocal: string | null;
}): CustomDomainView {
  const status = row.status === 'verified' ? 'verified' : 'requested';
  return {
    id: row.id,
    hostname: row.hostname,
    status,
    // The token is only useful before verification; after that it is hidden.
    verificationToken: status === 'verified' ? null : row.verificationToken,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    brandedFromLocal: row.brandedFromLocal,
    brandedFromAddress: brandedSenderAddress(row.hostname, row.brandedFromLocal),
  };
}

/** A workspace manager requests a domain. The TXT token is issued at once; nothing is verified yet. */
export async function requestCustomDomain(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
): Promise<CustomDomainView> {
  assertCan(actor, 'settings:org:update');
  const hostname = cleanHostname(input.hostname);
  const existing = await db(tx).customDomain.findFirst({
    where: { hostname },
    select: {
      id: true,
      hostname: true,
      status: true,
      verificationToken: true,
      verifiedAt: true,
      brandedFromLocal: true,
    },
  });
  if (existing) throw new DomainError('CONFLICT', 'That domain is already requested.');
  const token = generateVerificationToken();
  const row = await db(tx).customDomain.create({
    data: { hostname, status: 'requested', verificationToken: token, brandedFromLocal: null },
    select: { id: true },
  });
  return toView({
    id: row.id,
    hostname,
    status: 'requested',
    verificationToken: token,
    verifiedAt: null,
    brandedFromLocal: null,
  });
}

/**
 * The coach attests the DNS record is set. This records verification only —
 * it does NOT check DNS (see the module header). The follow-up that checks
 * the TXT record must replace this body before verified domains are trusted
 * for anything beyond this slice's UI.
 */
export async function markDomainVerified(
  tx: TenantTx,
  actor: ActorContext,
  domainId: string,
  opts: { now?: Date } = {},
): Promise<CustomDomainView> {
  assertCan(actor, 'settings:org:update');
  const now = opts.now ?? new Date();
  const existing = await db(tx).customDomain.findFirst({
    where: { id: domainId },
    select: {
      id: true,
      hostname: true,
      status: true,
      verificationToken: true,
      verifiedAt: true,
      brandedFromLocal: true,
    },
  });
  if (!existing) throw notFound();
  await db(tx).customDomain.update({
    where: { id: existing.id },
    data: { status: 'verified', verifiedAt: now },
  });
  return toView({ ...existing, status: 'verified', verifiedAt: now });
}

/** Sets the branded sending address on a VERIFIED domain. Unverified domains can never send. */
export async function setBrandedSender(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
): Promise<CustomDomainView> {
  assertCan(actor, 'settings:org:update');
  const local = cleanLocalPart(input.brandedFromLocal);
  if (typeof input.domainId !== 'string') throw notFound();
  const existing = await db(tx).customDomain.findFirst({
    where: { id: input.domainId },
    select: {
      id: true,
      hostname: true,
      status: true,
      verificationToken: true,
      verifiedAt: true,
      brandedFromLocal: true,
    },
  });
  if (!existing) throw notFound();
  if (existing.status !== 'verified') {
    throw invalid('domainId', 'Verify the domain before setting a sending address.');
  }
  await db(tx).customDomain.update({
    where: { id: existing.id },
    data: { brandedFromLocal: local },
  });
  return toView({ ...existing, brandedFromLocal: local });
}

/** The workspace's domains, requested first, then verified. */
export async function listCustomDomains(
  tx: TenantTx,
  actor: ActorContext,
): Promise<CustomDomainView[]> {
  assertCan(actor, 'settings:org:update');
  const rows = await db(tx).customDomain.findMany({
    orderBy: [{ status: 'asc' }, { hostname: 'asc' }],
    select: {
      id: true,
      hostname: true,
      status: true,
      verificationToken: true,
      verifiedAt: true,
      brandedFromLocal: true,
    },
  });
  return rows.map(toView);
}
