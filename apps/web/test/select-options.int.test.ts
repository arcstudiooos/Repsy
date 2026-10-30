import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProgram, type ActorContext } from '@kinetic/core';
import { withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth } from '@/lib/auth';
import { collectPages, loadAllTemplates } from '@/server/selectOptions';
import { seedTwoTenants, TEST_SECRET, type TwoTenants } from './harness/tenants';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let t: TwoTenants;

beforeAll(async () => {
  let authPrisma: PrismaClient;
  ({ prisma, authPrisma, drop } = await createTestDb());
  const auth = createAuth({
    prisma,
    authPrisma,
    env: {
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: TEST_SECRET,
      DISABLE_BREACHED_PASSWORD_CHECK: 'true',
    },
  });
  t = await seedTwoTenants(prisma, auth);
});
afterAll(async () => {
  await drop();
});

describe('select options', () => {
  it('loads every page: the 26th template is present', async () => {
    const actor: ActorContext = {
      userId: t.coachA.id,
      orgId: t.orgA.id,
      role: 'owner',
      isPlatformAdmin: false,
    };
    const result = await withTenant(
      t.orgA.id,
      async (tx) => {
        for (let i = 1; i <= 26; i++) await createProgram(tx, actor, { title: `Tpl ${i}` });
        return loadAllTemplates(tx, actor);
      },
      prisma,
      { userId: actor.userId },
    );
    expect(result.capped).toBe(false);
    expect(result.items).toHaveLength(26);
    expect(result.items.map((p) => p.title)).toContain('Tpl 1');
  });

  it('caps at the limit and reports it', async () => {
    const pages = [...Array(10).keys()].map((p) => ({
      items: Array.from({ length: 25 }, (_, i) => p * 25 + i),
      nextCursor: p < 9 ? String(p + 1) : null,
    }));
    const capped = await collectPages(async (c) => pages[Number(c ?? 0)]!, 200);
    expect(capped.items).toHaveLength(200);
    expect(capped.capped).toBe(true);
    const exact = await collectPages(async (c) => pages[Number(c ?? 0)]!, 250);
    expect(exact.items).toHaveLength(250);
    expect(exact.capped).toBe(false);
  });
});
