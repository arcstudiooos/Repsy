import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { canonicalTimezone } from '../timezone';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { getSettings, updateSettings } from './settings';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let orgId: string;
const users: Record<'owner' | 'coach' | 'client', string> = { owner: '', coach: '', client: '' };
let clientId: string;

const actor = (role: 'owner' | 'coach' | 'client'): ActorContext => ({
  userId: users[role],
  orgId,
  role,
  isPlatformAdmin: false,
  ...(role === 'client' ? { clientId } : {}),
});

const run = <T>(a: ActorContext, fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(a.orgId, fn, prisma, { userId: a.userId });

const failure = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) =>
      e instanceof DomainError
        ? e
        : (() => {
            throw e;
          })(),
  );

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  await withSystem(async (tx) => {
    for (const role of ['owner', 'coach', 'client'] as const) {
      users[role] = (
        await tx.user.create({ data: { email: `${role}@example.test`, name: role } })
      ).id;
    }
    orgId = (
      await tx.organization.create({
        data: { name: 'Org', timezone: 'Europe/London', ownerUserId: users.owner },
      })
    ).id;
    await tx.membership.createMany({
      data: (['owner', 'coach', 'client'] as const).map((role) => ({
        userId: users[role],
        organizationId: orgId,
        role,
      })),
    });
    clientId = (
      await tx.client.create({
        data: {
          organizationId: orgId,
          userId: users.client,
          coachUserId: users.owner,
          name: 'C',
          email: 'client@example.test',
          status: 'active',
          timezone: 'Europe/London',
        },
      })
    ).id;
  }, prisma);
});
afterAll(async () => {
  await drop();
});

describe('getSettings', () => {
  it('marketing and message prefs default off', async () => {
    const a = actor('client');
    const view = await run(a, (tx) => getSettings(tx, a));
    expect(view.notifications).toEqual({
      messageEmailOptIn: false,
      marketingOptIn: false,
      digestEmailOptIn: false,
      weeklyBriefOptIn: false,
      workoutReminderOptIn: false,
      checkinReminderOptIn: false,
      habitReminderOptIn: false,
    });
  });

  it('creates the coach profile lazily with kg units; clients get no profile', async () => {
    const a = actor('coach');
    const count = () =>
      withSystem((tx) => tx.coachProfile.count({ where: { userId: a.userId } }), prisma);
    expect(await count()).toBe(0);
    const view = await run(a, (tx) => getSettings(tx, a));
    expect(view.profile).toEqual({ bio: null, specialties: [], units: 'kg' });
    expect(await count()).toBe(1);
    const c = actor('client');
    const cv = await run(c, (tx) => getSettings(tx, c));
    expect(cv.profile).toBeNull();
    expect(cv.org).toBeUndefined();
    expect(cv.client).toEqual({ timezone: 'Europe/London', preferredUnits: 'kg' });
  });

  it('reports the org with the invited+active client count', async () => {
    const a = actor('owner');
    const view = await run(a, (tx) => getSettings(tx, a));
    expect(view.org).toEqual({
      name: 'Org',
      timezone: 'Europe/London',
      graceHours: 24,
      activeClientLimit: 30,
      activeClientCount: 1,
    });
  });
});

describe('updateSettings', () => {
  it('graceHours 73 → VALIDATION', async () => {
    const a = actor('owner');
    const err = await failure(run(a, (tx) => updateSettings(tx, a, { org: { graceHours: 73 } })));
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect(err?.fieldErrors).toHaveProperty(['org.graceHours']);
  });

  it('accepts graceHours 0 and 72, rejects -1 and 1.5', async () => {
    const a = actor('owner');
    for (const graceHours of [0, 72]) {
      await run(a, (tx) => updateSettings(tx, a, { org: { graceHours } }));
    }
    for (const graceHours of [-1, 1.5]) {
      expect(
        await failure(run(a, (tx) => updateSettings(tx, a, { org: { graceHours } }))),
      ).toMatchObject({ code: 'VALIDATION' });
    }
  });

  it('invalid timezone → VALIDATION', async () => {
    const a = actor('owner');
    expect(
      await failure(run(a, (tx) => updateSettings(tx, a, { org: { timezone: 'Mars/Base' } }))),
    ).toMatchObject({ code: 'VALIDATION' });
    const c = actor('client');
    expect(
      await failure(run(c, (tx) => updateSettings(tx, c, { client: { timezone: 'Nope' } }))),
    ).toMatchObject({ code: 'VALIDATION' });
  });

  it('browser aliases and any letter case are stored canonical (org and client)', async () => {
    const a = actor('owner');
    await run(a, (tx) => updateSettings(tx, a, { org: { timezone: 'europe/london' } }));
    const org = await withSystem(
      (tx) => tx.organization.findUniqueOrThrow({ where: { id: a.orgId } }),
      prisma,
    );
    expect(org.timezone).toBe('Europe/London');
    const c = actor('client');
    await run(c, (tx) => updateSettings(tx, c, { client: { timezone: 'Asia/Kolkata' } }));
    expect((await run(c, (tx) => getSettings(tx, c))).client?.timezone).toBe(
      canonicalTimezone('Asia/Kolkata'),
    );
    await run(c, (tx) => updateSettings(tx, c, { client: { timezone: 'Etc/UTC' } }));
    expect((await run(c, (tx) => getSettings(tx, c))).client?.timezone).toBe('UTC');
  });

  it('client cannot patch org', async () => {
    const c = actor('client');
    expect(
      await failure(run(c, (tx) => updateSettings(tx, c, { org: { name: 'Mine' } }))),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await failure(run(c, (tx) => updateSettings(tx, c, { profile: { bio: 'x' } }))),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('non-owner coach cannot patch org; coach cannot patch client block', async () => {
    const a = actor('coach');
    expect(
      await failure(run(a, (tx) => updateSettings(tx, a, { org: { name: 'Mine' } }))),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await failure(run(a, (tx) => updateSettings(tx, a, { client: { preferredUnits: 'lb' } }))),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('owner updates org, profile and notifications; returns changed field names', async () => {
    const a = actor('owner');
    const changed = await run(a, (tx) =>
      updateSettings(tx, a, {
        org: { name: '  New name ', graceHours: 36, timezone: 'Asia/Tokyo' },
        profile: { bio: ' Hi ', specialties: ['Strength', 'Mobility'], units: 'lb' },
        notifications: { messageEmailOptIn: true },
      }),
    );
    expect(changed.sort()).toEqual([
      'notifications.messageEmailOptIn',
      'org.graceHours',
      'org.name',
      'org.timezone',
      'profile.bio',
      'profile.specialties',
      'profile.units',
    ]);
    const view = await run(a, (tx) => getSettings(tx, a));
    expect(view.org).toMatchObject({ name: 'New name', graceHours: 36, timezone: 'Asia/Tokyo' });
    expect(view.profile).toEqual({ bio: 'Hi', specialties: ['Strength', 'Mobility'], units: 'lb' });
    expect(view.notifications).toEqual({
      messageEmailOptIn: true,
      marketingOptIn: false,
      digestEmailOptIn: false,
      weeklyBriefOptIn: false,
      workoutReminderOptIn: false,
      checkinReminderOptIn: false,
      habitReminderOptIn: false,
    });
  });

  it('validates profile limits', async () => {
    const a = actor('coach');
    const bad = [
      { bio: 'x'.repeat(1001) },
      { specialties: Array.from({ length: 11 }, (_, i) => `s${i}`) },
      { specialties: ['x'.repeat(41)] },
      { units: 'stone' as unknown as 'kg' },
    ];
    for (const profile of bad) {
      expect(await failure(run(a, (tx) => updateSettings(tx, a, { profile })))).toMatchObject({
        code: 'VALIDATION',
      });
    }
  });

  it('client updates their own Client row only', async () => {
    const c = actor('client');
    const changed = await run(c, (tx) =>
      updateSettings(tx, c, { client: { timezone: 'America/New_York', preferredUnits: 'lb' } }),
    );
    expect(changed.sort()).toEqual(['client.preferredUnits', 'client.timezone']);
    const row = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: clientId } }),
      prisma,
    );
    expect(row).toMatchObject({ timezone: 'America/New_York', preferredUnits: 'lb' });
  });
});

describe('coach digest preference (PRD H14)', () => {
  it('a coach turns it on; a client cannot', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    await runAs(prisma, org.coach, (tx) =>
      updateSettings(tx, org.coach, { notifications: { digestEmailOptIn: true } }),
    );
    expect(
      (await runAs(prisma, org.coach, (tx) => getSettings(tx, org.coach))).notifications
        .digestEmailOptIn,
    ).toBe(true);
    await runAs(prisma, w.client, (tx) =>
      updateSettings(tx, w.client, { notifications: { digestEmailOptIn: true } }),
    );
    expect(
      (await runAs(prisma, w.client, (tx) => getSettings(tx, w.client))).notifications
        .digestEmailOptIn,
    ).toBe(false);
  });
});
