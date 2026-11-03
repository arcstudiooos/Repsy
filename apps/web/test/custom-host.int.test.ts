import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { clearCustomHostCache, customHostResponse } from '@/server/customHost';

let prisma: PrismaClient;
let drop: () => Promise<void>;
const HOST = 'coach.example.test';

beforeAll(async () => {
  process.env.APP_BASE_URL = 'https://app.repsy.test';
  ({ prisma, drop } = await createTestDb());
  await withSystem(async (tx) => {
    const u = await tx.user.create({
      data: { email: `o-${Date.now()}@example.test`, name: 'Owner' },
    });
    const org = await tx.organization.create({
      data: {
        name: 'Org',
        timezone: 'UTC',
        ownerUserId: u.id,
        publicSlug: 'jo-fit',
        publicPageEnabled: true,
      },
    });
    await tx.customDomain.create({
      data: {
        organizationId: org.id,
        hostname: HOST,
        verifyToken: 'a'.repeat(32),
        status: 'verified',
        verifiedAt: new Date(),
      },
    });
    await tx.customDomain.create({
      data: {
        organizationId: (
          await tx.organization.create({ data: { name: 'O2', timezone: 'UTC', ownerUserId: u.id } })
        ).id,
        hostname: 'pending.example.test',
        verifyToken: 'b'.repeat(32),
      },
    });
  }, prisma);
});
afterAll(async () => {
  await drop();
});
beforeEach(() => clearCustomHostCache());

const req = (url: string, host: string) => new NextRequest(url, { headers: { host } });

describe('custom host routing (L4, D-013 #15)', () => {
  it('serves the public page and thanks page on a verified domain', async () => {
    const home = await customHostResponse(req(`https://${HOST}/`, HOST), prisma);
    expect(home?.headers.get('x-middleware-rewrite')).toMatch(/\/join\/jo-fit$/);
    const thanks = await customHostResponse(req(`https://${HOST}/thanks?purchase=1`, HOST), prisma);
    expect(thanks?.headers.get('x-middleware-rewrite')).toMatch(
      /\/join\/jo-fit\/thanks\?purchase=1$/,
    );
  });

  it('sends everything else on that host to the main domain; assets load', async () => {
    for (const path of ['/login', '/portal', '/api/v1/me', '/app/clients']) {
      const r = await customHostResponse(req(`https://${HOST}${path}?x=1`, HOST), prisma);
      expect(r?.status).toBe(308);
      expect(r?.headers.get('location')).toBe(`https://app.repsy.test${path}?x=1`);
    }
    const asset = await customHostResponse(
      req(`https://${HOST}/_next/static/chunks/a.js`, HOST),
      prisma,
    );
    expect(asset?.headers.get('x-middleware-next')).toBe('1');
  });

  it('leaves the app host, unverified and unknown hosts alone', async () => {
    for (const host of [
      'app.repsy.test',
      'pending.example.test',
      'other.example.test',
      'localhost:3000',
    ]) {
      expect(await customHostResponse(req(`https://${host}/login`, host), prisma)).toBeNull();
    }
  });
});
