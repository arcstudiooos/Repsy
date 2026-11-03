import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { emitClientEvent } from '../automations/events';
import { processClientEvents } from '../automations/engine';
import { saveSequence } from '../automations/sequences';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  assertWorkspaceAccess,
  clearLapseCache,
  lapsedSince,
  lapseState,
  setWorkspaceLapsed,
} from './lapse';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});
beforeEach(() => clearLapseCache());

const DAY = 86_400_000;
const NOW = new Date('2026-11-04T15:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const admin = { userId: '00000000-0000-0000-0000-000000000000', isPlatformAdmin: true };
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : `other:${String(e)}`),
  );

describe('lapse rules (M12, D-013 #16)', () => {
  it('lapses on an admin mark or an ended trial, whichever came first', () => {
    const base = { lapsedAt: null, plan: 'pilot', trialEndsAt: null };
    expect(lapsedSince(base, NOW)).toBeNull();
    expect(lapsedSince({ ...base, plan: 'trial', trialEndsAt: at(1) }, NOW)).toBeNull();
    expect(lapsedSince({ ...base, plan: 'trial', trialEndsAt: at(-2) }, NOW)).toEqual(at(-2));
    expect(lapsedSince({ plan: 'trial', trialEndsAt: at(-2), lapsedAt: at(-5) }, NOW)).toEqual(
      at(-5),
    );
    expect(lapseState({ ...base, lapsedAt: NOW }, NOW)).toMatchObject({
      lapsed: true,
      clientReadUntil: at(90).toISOString(),
      staffReadUntil: at(180).toISOString(),
    });
  });

  it('refuses writes, allows exempt ones, and closes reads after 90 days for clients and 180 for staff', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const gate = (actor: ActorContext, write: boolean, now: Date, exempt = false) =>
      code(assertWorkspaceAccess(prisma, actor, { write, exempt, now }));
    expect(await gate(w.coach, true, NOW)).toBe('ok');
    await withSystem((tx) => setWorkspaceLapsed(tx, admin, w.orgId, true, NOW), prisma);
    expect(await gate(w.coach, true, NOW)).toBe('WORKSPACE_LAPSED');
    expect(await gate(w.client, true, NOW)).toBe('WORKSPACE_LAPSED');
    expect(await gate(w.coach, true, NOW, true)).toBe('ok');
    expect(await gate(w.client, false, at(89))).toBe('ok');
    expect(await gate(w.client, false, at(91))).toBe('WORKSPACE_LAPSED');
    expect(await gate(w.coach, false, at(179))).toBe('ok');
    expect(await gate(w.coach, false, at(181))).toBe('WORKSPACE_LAPSED');
    // Only a platform admin can change it.
    expect(
      await code(
        withSystem(
          (tx) => setWorkspaceLapsed(tx, { ...admin, isPlatformAdmin: false }, w.orgId, false),
          prisma,
        ),
      ),
    ).toBe('NOT_FOUND');
    // Restoring lifts it at once, and converts an ended trial.
    await withSystem(
      (tx) =>
        tx.organization.update({
          where: { id: w.orgId },
          data: { plan: 'trial', trialEndsAt: at(-1) },
        }),
      prisma,
    );
    await withSystem((tx) => setWorkspaceLapsed(tx, admin, w.orgId, false, NOW), prisma);
    expect(await gate(w.coach, true, NOW)).toBe('ok');
    const org = await withSystem(
      (tx) =>
        tx.organization.findUniqueOrThrow({
          where: { id: w.orgId },
          select: { plan: true, trialEndsAt: true },
        }),
      prisma,
    );
    expect(org).toEqual({ plan: 'pilot', trialEndsAt: null });
  });

  it('a lapsed workspace starts no automations, and its events are not replayed after a restore', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    await runAs(prisma, w.coach, (tx) =>
      saveSequence(tx, w.coach, {
        name: 'Welcome',
        trigger: 'stage_changed',
        steps: [{ dayOffset: 0, localTime: '09:00', type: 'followup', config: { title: 'Hi' } }],
      }),
    );
    await withSystem((tx) => setWorkspaceLapsed(tx, admin, w.orgId, true), prisma);
    await runAs(prisma, w.coach, (tx) =>
      emitClientEvent(tx, w.clientId, 'stage_changed', { stage: 'active' }),
    );
    await processClientEvents(prisma);
    await withSystem((tx) => setWorkspaceLapsed(tx, admin, w.orgId, false), prisma);
    await processClientEvents(prisma);
    const runs = await withSystem(
      (tx) => tx.sequenceRun.count({ where: { clientId: w.clientId } }),
      prisma,
    );
    expect(runs).toBe(0);
  });
});
