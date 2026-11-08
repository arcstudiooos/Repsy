import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { updateClientContext } from '../clients/context';
import { BENCH, newClientWorld, newOrg, PRESS, runAs } from '../sessions/fixtures.test-helpers';
import { setAlternatives } from './alternatives';
import { equipmentGuideFor } from './equipmentGuide';
import { outsideKit } from './options';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('equipment profile (PRD B13)', () => {
  it('flags only equipment outside a recorded kit', () => {
    expect(outsideKit('Barbell', ['Dumbbell'])).toBe(true);
    expect(outsideKit('Dumbbell', ['Dumbbell'])).toBe(false);
    expect(outsideKit('Bodyweight', ['Dumbbell'])).toBe(false);
    expect(outsideKit('Barbell', [])).toBe(false);
  });

  it('records location and kit, and offers alternatives that fit', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    expect(
      await runAs(prisma, org.coach, (tx) => equipmentGuideFor(tx, org.coach, w.clientId, [BENCH])),
    ).toBeNull();
    const ctx = await runAs(prisma, org.coach, (tx) =>
      updateClientContext(tx, org.coach, w.clientId, {
        trainingLocation: 'home',
        equipment: ['Dumbbell', 'Band', 'Dumbbell'],
      }),
    );
    expect(ctx).toMatchObject({ trainingLocation: 'home', equipment: ['Dumbbell', 'Band'] });
    await expect(
      runAs(prisma, org.coach, (tx) =>
        updateClientContext(tx, org.coach, w.clientId, { equipment: ['Spaceship'] }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // The bench (barbell) has the incline dumbbell press as an alternative.
    await runAs(prisma, org.coach, (tx) => setAlternatives(tx, org.coach, BENCH, [PRESS]));
    const guide = await runAs(prisma, org.coach, (tx) =>
      equipmentGuideFor(tx, org.coach, w.clientId, [BENCH, PRESS]),
    );
    expect(guide).toMatchObject({ kit: ['Dumbbell', 'Band'] });
    expect(guide!.exercises[BENCH]).toMatchObject({
      equipment: 'Barbell',
      fits: [{ exerciseId: PRESS }],
    });
    expect(outsideKit(guide!.exercises[PRESS]!.equipment, guide!.kit)).toBe(false);
  });
});
