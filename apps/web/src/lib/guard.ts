import { NextResponse, type NextRequest } from 'next/server';
import type { PrismaClient } from '@kinetic/db';
import { getSessionUser, type Auth, type SessionUser } from './auth';
import { hasCoachMembership, ONBOARDING_PATH } from './membership';

const PROTECTED_PREFIXES = ['/app', '/portal', '/settings', '/admin', '/onboarding'] as const;

export const isProtectedPath = (pathname: string): boolean =>
  PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export type AccessDecision =
  { type: 'allow' } | { type: 'redirect'; to: string } | { type: 'forbidden' };

/** Pure access rules for protected paths. */
export function decideAccess(pathname: string, user: SessionUser | null): AccessDecision {
  if (!isProtectedPath(pathname)) return { type: 'allow' };
  if (!user) return { type: 'redirect', to: `/login?next=${encodeURIComponent(pathname)}` };
  if (!user.emailVerified) return { type: 'redirect', to: '/verify-email' };
  if ((pathname === '/admin' || pathname.startsWith('/admin/')) && !user.isPlatformAdmin) {
    return { type: 'forbidden' };
  }
  return { type: 'allow' };
}

const isAppPath = (pathname: string): boolean =>
  pathname === '/app' || pathname.startsWith('/app/');

/** Returns a response when the request must not proceed, otherwise null. */
export async function guardRequest(
  request: NextRequest,
  deps: { auth?: Pick<Auth, 'api'>; prisma?: PrismaClient } = {},
): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (!isProtectedPath(pathname)) return null;
  const user = await getSessionUser(request.headers, deps.auth);
  const decision = decideAccess(pathname, user);
  if (decision.type === 'redirect') return NextResponse.redirect(new URL(decision.to, request.url));
  // The admin console is invisible to non-admins (S5-3): not found, not forbidden.
  if (decision.type === 'forbidden') return new NextResponse('Not Found', { status: 404 });
  // Verified but no workspace (Google-less orphans, failed provisioning): redeem a pilot code.
  if (user && isAppPath(pathname) && !(await hasCoachMembership(deps.prisma, user.id))) {
    return NextResponse.redirect(new URL(ONBOARDING_PATH, request.url));
  }
  return null;
}
