import { withSystem, type PrismaClient, type TenantTx } from '@kinetic/db';
import { STAFF_ROLES, type ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';

/**
 * PRD A16: single sign-on for a workspace's team. A workspace picks Google Workspace or Microsoft Entra ID
 * and the email domain its staff use. With `enforced`, staff on that domain cannot sign in with a password;
 * they use the provider. Accounts are never created by SSO: a team member is invited first, then signs in.
 *
 * Microsoft lets any directory put any email on an account, so a Microsoft sign-in is accepted only when the
 * token comes from the workspace's own directory (tenant id) and the user is staff on the configured domain.
 */
export type SsoProvider = 'google' | 'microsoft';

export interface SsoSettingView {
  provider: SsoProvider;
  domain: string;
  microsoftTenantId: string | null;
  enforced: boolean;
}

/** Consumer mail domains: claiming one would cover strangers. */
const PUBLIC_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'zoho.com',
  'yandex.com',
  'rediffmail.com',
]);

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

export const emailDomain = (email: string): string =>
  email.trim().toLowerCase().split('@').pop() ?? '';

const view = (row: {
  provider: string;
  domain: string;
  microsoftTenantId: string | null;
  enforced: boolean;
}): SsoSettingView => ({
  provider: row.provider as SsoProvider,
  domain: row.domain,
  microsoftTenantId: row.microsoftTenantId,
  enforced: row.enforced,
});

export async function getSsoSetting(
  tx: TenantTx,
  actor: ActorContext,
): Promise<SsoSettingView | null> {
  assertCan(actor, 'org:read');
  const row = await tx.ssoSetting.findFirst({ where: { organizationId: actor.orgId } });
  return row ? view(row) : null;
}

/**
 * Saves the workspace's SSO setting. Managers only. The domain must be the manager's own email domain
 * (so a workspace cannot claim someone else's), and turning on `enforced` requires the manager to have
 * signed in with the provider once, so they cannot lock themselves out.
 */
export async function saveSsoSetting(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    provider: string;
    domain: string;
    microsoftTenantId?: string | null;
    enforced: boolean;
  },
  /** Providers the manager has signed in with (from the auth layer's account list). */
  linkedProviders: readonly string[],
): Promise<SsoSettingView> {
  assertCan(actor, 'settings:org:update');
  if (input.provider !== 'google' && input.provider !== 'microsoft') {
    throw invalid('provider', 'Pick Google Workspace or Microsoft.');
  }
  const domain = input.domain.trim().toLowerCase().replace(/^@/, '');
  if (!DOMAIN.test(domain)) throw invalid('domain', 'Enter a domain like studio.com.');
  if (PUBLIC_DOMAINS.has(domain)) {
    throw invalid('domain', 'Use your business domain, not a personal email provider.');
  }
  const me = await tx.user.findFirst({ where: { id: actor.userId }, select: { email: true } });
  if (!me || emailDomain(me.email) !== domain) {
    throw invalid('domain', 'Use the domain of your own email address.');
  }
  let microsoftTenantId: string | null = null;
  if (input.provider === 'microsoft') {
    microsoftTenantId = (input.microsoftTenantId ?? '').trim().toLowerCase();
    if (!GUID.test(microsoftTenantId)) {
      throw invalid('microsoftTenantId', 'Enter the Directory (tenant) ID from Microsoft Entra.');
    }
  }
  if (input.enforced) {
    if (!linkedProviders.includes(input.provider)) {
      throw invalid(
        'enforced',
        `Sign in with ${input.provider === 'google' ? 'Google' : 'Microsoft'} once yourself before requiring it, so you do not lock yourself out.`,
      );
    }
  }
  const data = { provider: input.provider, domain, microsoftTenantId, enforced: input.enforced };
  const row = await tx.ssoSetting.upsert({
    where: { organizationId: actor.orgId },
    create: { organizationId: actor.orgId, ...data },
    update: data,
  });
  return view(row);
}

export async function clearSsoSetting(
  tx: TenantTx,
  actor: ActorContext,
): Promise<{ cleared: boolean }> {
  assertCan(actor, 'settings:org:update');
  await tx.ssoSetting.deleteMany({ where: { organizationId: actor.orgId } });
  return { cleared: true };
}

/** SSO settings of the workspaces where this user is active staff, matching their email domain. */
async function staffSsoSettings(prisma: PrismaClient, where: { email?: string; userId?: string }) {
  return withSystem(async (tx) => {
    const user = await tx.user.findFirst({
      where: where.userId ? { id: where.userId } : { email: where.email?.trim().toLowerCase() },
      select: { id: true, email: true },
    });
    if (!user) return { user: null, settings: [] };
    const memberships = await tx.membership.findMany({
      where: { userId: user.id, status: 'active', role: { in: [...STAFF_ROLES] } },
      select: { organization: { select: { ssoSetting: true } } },
    });
    const domain = emailDomain(user.email);
    const settings = memberships
      .map((m) => m.organization.ssoSetting)
      .filter((s): s is NonNullable<typeof s> => s !== null && s.domain === domain);
    return { user, settings };
  }, prisma);
}

/**
 * Called before a password sign-in: the provider this email must use instead, or null when a password is
 * fine. Unknown emails return null so the response does not reveal whether an account exists.
 */
export async function ssoRequiredFor(
  prisma: PrismaClient,
  email: string,
): Promise<SsoProvider | null> {
  if (!email) return null;
  const { settings } = await staffSsoSettings(prisma, { email });
  const enforced = settings.find((s) => s.enforced);
  return enforced ? (enforced.provider as SsoProvider) : null;
}

/** Reads the `tid` claim from a Microsoft ID token (already received over TLS from Microsoft's token endpoint). */
export function microsoftTenantFromIdToken(idToken: string | null | undefined): string | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      tid?: unknown;
    };
    return typeof claims.tid === 'string' ? claims.tid.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Whether a Microsoft account may be linked to this user: they must be active staff in a workspace that set
 * up Microsoft SSO for their email domain, and the token must come from that workspace's directory.
 */
export async function microsoftLinkAllowed(
  prisma: PrismaClient,
  userId: string,
  tenantId: string | null,
): Promise<boolean> {
  if (!tenantId) return false;
  const { settings } = await staffSsoSettings(prisma, { userId });
  return settings.some((s) => s.provider === 'microsoft' && s.microsoftTenantId === tenantId);
}
