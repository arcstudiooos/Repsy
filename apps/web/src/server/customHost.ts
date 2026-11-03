import { NextResponse, type NextRequest } from 'next/server';
import { publicSlugForHost } from '@kinetic/core';
import { prisma as defaultPrisma, type PrismaClient } from '@kinetic/db';

/**
 * PRD L4 (D-013 #15): a verified custom domain serves only its workspace's public page and storefront. Every other
 * path redirects to the main domain, so sign-in, the portal, cookies, CSRF origins and OAuth callbacks never run on
 * a custom host. A host that isn't a verified custom domain is left alone (it behaves exactly as before).
 */
const TTL_MS = 60_000;
const cache = new Map<string, { slug: string | null; until: number }>();

async function slugFor(host: string, now: number, prisma: PrismaClient): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && hit.until > now) return hit.slug;
  let slug: string | null = null;
  try {
    slug = await publicSlugForHost(prisma, host);
  } catch {
    slug = null;
  }
  if (cache.size > 1000) cache.clear();
  cache.set(host, { slug, until: now + TTL_MS });
  return slug;
}

const appOrigin = () => (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/** Static files and Next's own assets load from any host. */
const isAsset = (path: string) =>
  path.startsWith('/_next/') || /\.[a-z0-9]{2,5}$/i.test(path) || path === '/manifest.webmanifest';

export async function customHostResponse(
  request: NextRequest,
  prisma: PrismaClient = defaultPrisma,
): Promise<NextResponse | null> {
  const host = (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '');
  let appHost = '';
  try {
    appHost = new URL(appOrigin()).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || host === appHost || host === 'localhost' || /^[\d.]+$/.test(host)) return null;
  const slug = await slugFor(host, Date.now(), prisma);
  if (!slug) return null;
  const { pathname, search } = request.nextUrl;
  if (isAsset(pathname)) return NextResponse.next();
  if (pathname === '/' || pathname === '/thanks') {
    const url = request.nextUrl.clone();
    url.pathname =
      pathname === '/'
        ? `/join/${encodeURIComponent(slug)}`
        : `/join/${encodeURIComponent(slug)}/thanks`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.redirect(`${appOrigin()}${pathname}${search}`, 308);
}

/** For tests. */
export const clearCustomHostCache = () => cache.clear();
