import { NextResponse, type NextRequest } from 'next/server';
import { guardRequest } from '@/lib/guard';
import { marketingHostRedirect, parseHosts, requestHost } from '@/lib/marketingHost';

const marketingHosts = parseHosts(process.env.MARKETING_HOSTS);

// Next 16 renamed middleware.ts to proxy.ts; it runs on the Node.js runtime,
// so it can validate the DB-backed session (not just cookie presence).
export async function proxy(request: NextRequest): Promise<NextResponse> {
  // repsy.fit serves only the landing page; sign-up, log-in and the app live on APP_BASE_URL.
  const to = marketingHostRedirect(
    requestHost(request.headers),
    request.nextUrl.pathname,
    request.nextUrl.search,
    { marketingHosts, appBaseUrl: process.env.APP_BASE_URL },
  );
  if (to) return NextResponse.redirect(to, 308);
  // Only protected prefixes are checked (guardRequest returns null for everything else).
  return (await guardRequest(request)) ?? NextResponse.next();
}

// Every page and route (the marketing-host check needs them all), but not Next's static assets.
// `/invite/*` and `/select-org` pass the guard: invites are public (the token is the credential, the page checks
// it) and the chooser checks the session itself.
export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
