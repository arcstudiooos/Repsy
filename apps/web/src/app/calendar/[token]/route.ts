import { calendarFeed } from '@repsy/core';
import { prisma } from '@repsy/db';
import { clientIp } from '@/server/clientIp';
import { InMemoryRateLimiter } from '@/server/rateLimit';

/** Calendar apps poll every few hours; this is generous for one person and tight for a scraper. */
const limiter = new InMemoryRateLimiter({ capacity: 30, refillPerSecond: 30 / 3600 });

/**
 * `GET /calendar/<token>.ics` (PRD L7): the client's private workout feed. Public by design (calendar apps can't sign
 * in): the token is the credential, and an unknown or replaced one is a plain 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limit = await limiter.consume(`ip:${clientIp(request.headers)}`);
  if (!limit.allowed) return new Response('Too many requests', { status: 429 });
  const token = (await params).token.replace(/\.ics$/, '');
  const ics = await calendarFeed(prisma, token, { appBaseUrl: process.env.APP_BASE_URL });
  if (!ics) return new Response('Not found', { status: 404 });
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'private, max-age=900',
      'x-robots-tag': 'noindex',
    },
  });
}
