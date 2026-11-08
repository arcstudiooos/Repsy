import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { getBranding, updateBranding } from './branding';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('workspace branding (PRD A6)', () => {
  it('owner sets an AA accent and an https logo; clients read it; bad input is refused', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const set = (input: Parameters<typeof updateBranding>[2]) =>
      runAs(prisma, org.coach, (tx) => updateBranding(tx, org.coach, input));
    const b = await set({ accent: '#7A1F5C', logoUrl: 'https://cdn.example/logo.png' });
    expect(b).toMatchObject({ accent: '#7a1f5c', logoUrl: 'https://cdn.example/logo.png' });
    expect(b.accentHover).toMatch(/^#[0-9a-f]{6}$/);
    expect(await runAs(prisma, w.client, (tx) => getBranding(tx))).toMatchObject({
      accent: '#7a1f5c',
    });

    const field = (input: Parameters<typeof updateBranding>[2]) =>
      set(input).then(
        () => 'ok',
        (e: { fieldErrors?: Record<string, string[]> }) => Object.keys(e.fieldErrors ?? {})[0],
      );
    expect(await field({ accent: '#ffee88' })).toBe('accent');
    expect(await field({ logoUrl: 'http://cdn.example/logo.png' })).toBe('logoUrl');
    expect(await field({ logoUrl: 'javascript:alert(1)' })).toBe('logoUrl');
    await expect(
      runAs(prisma, w.client, (tx) => updateBranding(tx, w.client, { accent: '#000000' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await set({ accent: null, logoUrl: '' })).toMatchObject({
      accent: null,
      logoUrl: null,
      accentHover: null,
    });
  });
});
