import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { accentProblem, darken } from './color';

export const LOGO_URL_MAX = 500;

export interface Branding {
  name: string;
  /** #rrggbb, or null for Kinetic's own accent. */
  accent: string | null;
  /** The accent's hover shade, when an accent is set. */
  accentHover: string | null;
  logoUrl: string | null;
}

/** The workspace's branding (PRD A6), for the portal and settings. Any member may read it. */
export async function getBranding(tx: TenantTx): Promise<Branding> {
  const org = await tx.organization.findFirst({
    select: { name: true, brandAccent: true, logoUrl: true },
  });
  if (!org) throw new DomainError('NOT_FOUND', 'Not found.');
  return {
    name: org.name,
    accent: org.brandAccent,
    accentHover: org.brandAccent ? darken(org.brandAccent) : null,
    logoUrl: org.logoUrl,
  };
}

/** Owner only. The accent must keep white text at 4.5:1 or more; the logo must be an https link. */
export async function updateBranding(
  tx: TenantTx,
  actor: ActorContext,
  input: { accent?: unknown; logoUrl?: unknown },
  opts: { requestId?: string } = {},
): Promise<Branding> {
  assertCan(actor, 'settings:org:update');
  const invalid = (field: string, message: string) =>
    new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
  const data: { brandAccent?: string | null; logoUrl?: string | null } = {};
  if (input.accent !== undefined) {
    if (input.accent === null || input.accent === '') data.brandAccent = null;
    else {
      if (typeof input.accent !== 'string') throw invalid('accent', 'Use a colour like #1c7666.');
      const problem = accentProblem(input.accent);
      if (problem) throw invalid('accent', problem);
      data.brandAccent = input.accent.trim().toLowerCase();
    }
  }
  if (input.logoUrl !== undefined) {
    if (input.logoUrl === null || input.logoUrl === '') data.logoUrl = null;
    else {
      const url = typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '';
      let ok = false;
      try {
        ok = new URL(url).protocol === 'https:' && url.length <= LOGO_URL_MAX;
      } catch {
        ok = false;
      }
      if (!ok) throw invalid('logoUrl', 'Use a full https:// link to an image.');
      data.logoUrl = url;
    }
  }
  if (Object.keys(data).length > 0) {
    await tx.organization.update({ where: { id: actor.orgId }, data });
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'organization',
      objectId: actor.orgId,
      action: 'organization.branding_updated',
      metadata: { fields: Object.keys(data).join(',') },
      requestId: opts.requestId,
    });
  }
  return getBranding(tx);
}
