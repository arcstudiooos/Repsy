import {
  appendAudit,
  withTenant,
  type PrismaClient,
  type SystemTx,
  type TenantTx,
} from '@repsy/db';
import { isManager, type ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { createClient, EMAIL } from '../clients/clients';
import { DomainError } from '../errors';
import { issueInvite } from '../invites/invites';
import { enqueueEmail } from '../outbox';
import { isUuid } from '../uuid';

/**
 * PRD B15, B16: a workspace's public page (/join/<slug>: bio, offers, an application form) and the pipeline of the
 * people who apply. A visitor has no membership: the slug becomes an organization id only through
 * `app_org_by_public_slug` (an enabled page only), and everything else runs in that organization's tenant scope.
 */
export const LEAD_STATUSES = ['new', 'contacted', 'call_booked', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/;
/** A form filled faster than this is a bot. */
export const MIN_FILL_MS = 3000;

export interface PublicProfile {
  orgName: string;
  bio: string | null;
  offers: string | null;
}

export interface LeadView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  status: LeadStatus;
  notes: string;
  convertedClientId: string | null;
  createdAt: string;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

async function orgBySlug(prisma: PrismaClient, slug: string): Promise<string | null> {
  if (!SLUG.test(slug)) return null;
  const rows = await (prisma as unknown as Pick<SystemTx, '$queryRaw'>).$queryRaw<
    { id: string | null }[]
  >`
    SELECT app_org_by_public_slug(${slug}) AS id`;
  return rows[0]?.id ?? null;
}

export async function getPublicProfile(
  prisma: PrismaClient,
  slug: string,
): Promise<PublicProfile | null> {
  const orgId = await orgBySlug(prisma, slug);
  if (!orgId) return null;
  return withTenant(
    orgId,
    async (tx) => {
      const org = await tx.organization.findFirstOrThrow({
        select: { name: true, publicBio: true, publicOffers: true },
      });
      return { orgName: org.name, bio: org.publicBio, offers: org.publicOffers };
    },
    prisma,
  );
}

/**
 * Files an application. Bots get the same answer as people but nothing is stored: a filled honeypot, or a form sent
 * within MIN_FILL_MS of the page loading. The owner is emailed that a new application arrived (its name only).
 */
export async function submitLead(
  prisma: PrismaClient,
  slug: string,
  input: {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    message?: unknown;
    website?: unknown;
    loadedAt?: unknown;
  },
  now: Date = new Date(),
): Promise<{ received: true }> {
  const orgId = await orgBySlug(prisma, slug);
  if (!orgId) throw new DomainError('NOT_FOUND', 'Not found.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (name.length < 1 || name.length > 120) throw invalid('name', 'Enter your name.');
  if (!EMAIL.test(email) || email.length > 320) throw invalid('email', 'Enter your email address.');
  if (phone.length > 40) throw invalid('phone', 'Use at most 40 characters.');
  if (message.length > 4000) throw invalid('message', 'Use at most 4000 characters.');
  const loaded = typeof input.loadedAt === 'number' ? input.loadedAt : 0;
  const bot =
    (typeof input.website === 'string' && input.website !== '') ||
    now.getTime() - loaded < MIN_FILL_MS;
  if (bot) return { received: true };
  await withTenant(
    orgId,
    async (tx) => {
      const lead = await tx.lead.create({
        data: { name, email, phone: phone || null, message },
      } as Parameters<typeof tx.lead.create>[0]);
      const owner = await tx.membership.findFirst({
        where: { role: 'owner', status: 'active' },
        select: { userId: true },
      });
      if (owner) {
        await enqueueEmail(tx, {
          kind: 'new_lead',
          toUserId: owner.userId,
          templateKey: 'new_lead',
          payload: { leadName: name },
          idempotencyKey: `new-lead:${lead.id}`,
        });
      }
      await appendAudit(tx, {
        orgId,
        actorId: null,
        objectType: 'lead',
        objectId: lead.id,
        action: 'lead.received',
      });
    },
    prisma,
  );
  return { received: true };
}

const view = (r: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  status: string;
  notes: string;
  convertedClientId: string | null;
  createdAt: Date;
}): LeadView => ({ ...r, status: r.status as LeadStatus, createdAt: r.createdAt.toISOString() });

export async function listLeads(tx: TenantTx, actor: ActorContext): Promise<LeadView[]> {
  assertCan(actor, 'client:read');
  const rows = await tx.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  return rows.map(view);
}

export async function updateLead(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  input: { status?: unknown; notes?: unknown },
  opts: { requestId?: string } = {},
): Promise<LeadView> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const data: { status?: string; notes?: string } = {};
  if (input.status !== undefined) {
    if (!(LEAD_STATUSES as readonly unknown[]).includes(input.status))
      throw invalid('status', 'Pick a stage.');
    data.status = input.status as string;
  }
  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string' || input.notes.length > 4000)
      throw invalid('notes', 'Use at most 4000 characters.');
    data.notes = input.notes;
  }
  const { count } = await tx.lead.updateMany({ where: { id }, data });
  if (count === 0) throw new DomainError('NOT_FOUND', 'Not found.');
  if (data.status) {
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'lead',
      objectId: id,
      action: 'lead.stage_changed',
      metadata: { to: data.status },
      requestId: opts.requestId,
    });
  }
  return view(await tx.lead.findFirstOrThrow({ where: { id } }));
}

/** "Convert": the lead becomes a client with their application as goals, and gets the usual invite email. */
export async function convertLead(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  opts: { now?: Date; requestId?: string } = {},
): Promise<{ clientId: string }> {
  assertCan(actor, 'client:create');
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const lead = await tx.lead.findFirst({ where: { id } });
  if (!lead) throw new DomainError('NOT_FOUND', 'Not found.');
  if (lead.convertedClientId) throw new DomainError('CONFLICT', 'This lead is already a client.');
  const client = await createClient(tx, actor, {
    name: lead.name,
    email: lead.email,
    ...(lead.message ? { goals: lead.message.slice(0, 2000) } : {}),
  });
  await issueInvite(tx, actor, client.id, opts.now ?? new Date(), opts.requestId);
  await tx.lead.update({
    where: { id: lead.id },
    data: { status: 'won', convertedClientId: client.id },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'lead',
    objectId: lead.id,
    action: 'lead.converted',
    metadata: { clientId: client.id },
    requestId: opts.requestId,
  });
  return { clientId: client.id };
}

export interface PublicPageSettings {
  slug: string | null;
  bio: string | null;
  offers: string | null;
  enabled: boolean;
}

export async function getPublicPageSettings(tx: TenantTx): Promise<PublicPageSettings> {
  const o = await tx.organization.findFirstOrThrow({
    select: { publicSlug: true, publicBio: true, publicOffers: true, publicPageEnabled: true },
  });
  return {
    slug: o.publicSlug,
    bio: o.publicBio,
    offers: o.publicOffers,
    enabled: o.publicPageEnabled,
  };
}

export async function updatePublicPage(
  tx: TenantTx,
  actor: ActorContext,
  input: { slug?: unknown; bio?: unknown; offers?: unknown; enabled?: unknown },
  opts: { requestId?: string } = {},
): Promise<PublicPageSettings> {
  if (!isManager(actor.role))
    throw new DomainError('FORBIDDEN', 'Only the owner or an admin can change the public page.');
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
  if (slug && !SLUG.test(slug))
    throw invalid('slug', 'Use 3-40 lowercase letters, digits and dashes.');
  const text = (v: unknown, field: string, max: number) => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || v.length > max)
      throw invalid(field, `Use at most ${max} characters.`);
    return v.trim() || null;
  };
  const enabled = input.enabled === true;
  if (enabled && !slug) throw invalid('slug', 'Pick the address first.');
  try {
    await tx.organization.update({
      where: { id: actor.orgId },
      data: {
        publicSlug: slug || null,
        publicBio: text(input.bio, 'bio', 4000),
        publicOffers: text(input.offers, 'offers', 4000),
        publicPageEnabled: enabled,
      },
    });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'P2002')
      throw invalid('slug', 'That address is taken.');
    throw error;
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'organization',
    objectId: actor.orgId,
    action: 'organization.public_page_updated',
    metadata: { enabled },
    requestId: opts.requestId,
  });
  return getPublicPageSettings(tx);
}
