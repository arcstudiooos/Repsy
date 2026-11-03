import { NextResponse, type NextRequest } from 'next/server';
import { guardRequest } from '@/lib/guard';
import { customHostResponse } from '@/server/customHost';

// Next 16 renamed middleware.ts to proxy.ts; it runs on the Node.js runtime,
// so it can validate the DB-backed session (not just cookie presence).
export async function proxy(request: NextRequest): Promise<NextResponse> {
  // PRD L4: a verified custom domain serves the public page only (src/server/customHost.ts).
  const custom = await customHostResponse(request);
  if (custom) return custom;
  return (await guardRequest(request)) ?? NextResponse.next();
}

// `/invite/*` and `/select-org` are deliberately absent: invites are public (the token is the
// credential, the page checks it) and the chooser checks the session itself.
// Every path except Next's static assets: custom hosts are handled on any path; the session guard itself only acts
// on its protected prefixes (isProtectedPath in src/lib/guard.ts) and passes everything else through.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
