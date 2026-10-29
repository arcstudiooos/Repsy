import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser, type Auth, type SessionUser } from './auth';

const PROTECTED_PREFIXES = ['/app', '/portal', '/settings', '/admin'] as const;

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

/** Returns a response when the request must not proceed, otherwise null. */
export async function guardRequest(
  request: NextRequest,
  instance?: Pick<Auth, 'api'>,
): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (!isProtectedPath(pathname)) return null;
  const user = await getSessionUser(request.headers, instance);
  const decision = decideAccess(pathname, user);
  if (decision.type === 'redirect') return NextResponse.redirect(new URL(decision.to, request.url));
  if (decision.type === 'forbidden') return new NextResponse('Forbidden', { status: 403 });
  return null;
}
