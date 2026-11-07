import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { newClientWorld, newOrg, runAs, type ClientWorld } from '../sessions/fixtures.test-helpers';
import {
  clearSsoSetting,
  getSsoSetting,
  microsoftLinkAllowed,
  microsoftTenantFromIdToken,
  saveSsoSetting,
  ssoRequiredFor,
} from './sso';

/** PRD A16 single sign-on settings and checks against Postgres. */
let prisma: PrismaClient;
let drop: () => Promise<void>;
let w: ClientWorld;
let coachEmail: string;

const TENANT = '11111111-2222-4333-8444-555555555555';

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  w = await newClientWorld(prisma, await newOrg(prisma));
  const user = await withSystem(
    (tx) => tx.user.findUniqueOrThrow({ where: { id: w.coach.userId }, select: { email: true } }),
    prisma,
  );
  coachEmail = user.email;
});
afterAll(async () => {
  await drop();
});

const as = <T>(actor: ActorContext, fn: Parameters<typeof runAs<T>>[2]) => runAs(prisma, actor, fn);
const domain = () => coachEmail.split('@')[1]!;

describe('SSO settings (A16)', () => {
  it('rejects public, foreign and malformed domains', async () => {
    for (const d of ['gmail.com', 'other-studio.com', 'not a domain']) {
      await expect(
        as(w.coach, (tx) =>
          saveSsoSetting(tx, w.coach, { provider: 'google', domain: d, enforced: false }, []),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });

  it('clients cannot change SSO', async () => {
    await expect(
      as(w.client, (tx) =>
        saveSsoSetting(tx, w.client, { provider: 'google', domain: domain(), enforced: false }, []),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('enforcing needs the manager to have signed in with the provider', async () => {
    await expect(
      as(w.coach, (tx) =>
        saveSsoSetting(tx, w.coach, { provider: 'google', domain: domain(), enforced: true }, []),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await ssoRequiredFor(prisma, coachEmail)).toBeNull();

    await as(w.coach, (tx) =>
      saveSsoSetting(tx, w.coach, { provider: 'google', domain: domain(), enforced: true }, [
        'google',
      ]),
    );
    expect(await as(w.coach, (tx) => getSsoSetting(tx, w.coach))).toMatchObject({
      provider: 'google',
      enforced: true,
    });
    expect(await ssoRequiredFor(prisma, coachEmail.toUpperCase())).toBe('google');
    expect(await ssoRequiredFor(prisma, 'nobody@example.test')).toBeNull();
  });

  it('Microsoft needs a tenant id, and only that tenant can link', async () => {
    await expect(
      as(w.coach, (tx) =>
        saveSsoSetting(
          tx,
          w.coach,
          { provider: 'microsoft', domain: domain(), enforced: false },
          [],
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await as(w.coach, (tx) =>
      saveSsoSetting(
        tx,
        w.coach,
        { provider: 'microsoft', domain: domain(), microsoftTenantId: TENANT, enforced: false },
        [],
      ),
    );
    expect(await ssoRequiredFor(prisma, coachEmail)).toBeNull();
    expect(await microsoftLinkAllowed(prisma, w.coach.userId, TENANT)).toBe(true);
    expect(
      await microsoftLinkAllowed(prisma, w.coach.userId, '99999999-2222-4333-8444-555555555555'),
    ).toBe(false);
    expect(await microsoftLinkAllowed(prisma, w.coach.userId, null)).toBe(false);

    await as(w.coach, (tx) => clearSsoSetting(tx, w.coach));
    expect(await microsoftLinkAllowed(prisma, w.coach.userId, TENANT)).toBe(false);
  });

  it('reads the tenant from an ID token', () => {
    const body = Buffer.from(JSON.stringify({ tid: TENANT.toUpperCase() })).toString('base64url');
    expect(microsoftTenantFromIdToken(`x.${body}.y`)).toBe(TENANT);
    expect(microsoftTenantFromIdToken('garbage')).toBeNull();
    expect(microsoftTenantFromIdToken(null)).toBeNull();
  });
});
