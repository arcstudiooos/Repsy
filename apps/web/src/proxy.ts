import { NextResponse, type NextRequest } from 'next/server';
import { guardRequest } from '@/lib/guard';

// Next 16 renamed middleware.ts to proxy.ts; it runs on the Node.js runtime,
// so it can validate the DB-backed session (not just cookie presence).
export async function proxy(request: NextRequest): Promise<NextResponse> {
  return (await guardRequest(request)) ?? NextResponse.next();
}

export const config = {
  matcher: [
    '/app/:path*',
    '/portal/:path*',
    '/settings/:path*',
    '/admin/:path*',
    '/onboarding/:path*',
  ],
};
