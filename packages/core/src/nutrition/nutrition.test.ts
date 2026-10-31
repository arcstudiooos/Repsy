import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import { todayInZone } from '../timezone';
import { getNutrition, isOnTarget, logNutrition, setNutritionTarget } from './nutrition';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

const today = () => todayInZone('America/New_York');
const shift = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('isOnTarget', () => {
  it('judges only values both the target and the day have, within ±10%', () => {
    const t = { calories: 2000, proteinG: 150, carbsG: null, fatG: null };
    expect(isOnTarget(t, { calories: 2150, proteinG: 140, carbsG: 400, fatG: null })).toBe(true);
    expect(isOnTarget(t, { calories: 2300, proteinG: 150, carbsG: null, fatG: null })).toBe(false);
    expect(isOnTarget(t, { calories: null, proteinG: null, carbsG: 300, fatG: 80 })).toBeNull();
    expect(
      isOnTarget(null, { calories: 2000, proteinG: null, carbsG: null, fatG: null }),
    ).toBeNull();
  });
});

describe('nutrition (PRD G6/G7)', () => {
  it('coach sets targets; client logs days; adherence counts on-target days', async () => {
    const w = await newClientWorld(prisma, await newOrg(prisma));
    const t0 = today();
    await runAs(prisma, w.coach, (tx) =>
      setNutritionTarget(tx, w.coach, w.clientId, {
        calories: 2200,
        proteinG: 160,
        effectiveFrom: shift(t0, -6),
      }),
    );
    await runAs(prisma, w.client, (tx) =>
      logNutrition(tx, w.client, w.clientId, {
        calories: 2250,
        proteinG: 150,
        localDate: shift(t0, -1),
      }),
    );
    await runAs(prisma, w.client, (tx) =>
      logNutrition(tx, w.client, w.clientId, { calories: 2800, localDate: shift(t0, -2) }),
    );
    // Saving a day again replaces it.
    const view = await runAs(prisma, w.client, (tx) =>
      logNutrition(tx, w.client, w.clientId, {
        calories: 2300,
        proteinG: 165,
        localDate: shift(t0, -1),
      }),
    );
    expect(view.target).toMatchObject({ calories: 2200, proteinG: 160, carbsG: null });
    expect(view.days.map((d) => [d.localDate, d.calories, d.onTarget])).toEqual([
      [shift(t0, -1), 2300, true],
      [shift(t0, -2), 2800, false],
    ]);
    expect(view.adherence).toEqual({ onTarget: 1, logged: 2 });
    const coachView = await runAs(prisma, w.coach, (tx) => getNutrition(tx, w.coach, w.clientId));
    expect(coachView.days).toHaveLength(2);
  });

  it('validates values and dates; clients cannot set targets; scopes to the client', async () => {
    const org = await newOrg(prisma);
    const a = await newClientWorld(prisma, org);
    const b = await newClientWorld(prisma, org);
    const t0 = today();
    const err = (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { code?: string; fieldErrors?: Record<string, string[]> }) =>
          `${e.code}:${Object.keys(e.fieldErrors ?? {})[0] ?? ''}`,
      );
    expect(
      await err(runAs(prisma, a.client, (tx) => logNutrition(tx, a.client, a.clientId, {}))),
    ).toBe('VALIDATION:calories');
    expect(
      await err(
        runAs(prisma, a.client, (tx) => logNutrition(tx, a.client, a.clientId, { calories: 1.5 })),
      ),
    ).toBe('VALIDATION:calories');
    expect(
      await err(
        runAs(prisma, a.client, (tx) =>
          logNutrition(tx, a.client, a.clientId, { calories: 2000, localDate: shift(t0, -8) }),
        ),
      ),
    ).toBe('VALIDATION:localDate');
    expect(
      await err(
        runAs(prisma, a.client, (tx) =>
          setNutritionTarget(tx, a.client, a.clientId, { calories: 2000 }),
        ),
      ),
    ).toBe('FORBIDDEN:');
    expect(
      await err(
        runAs(prisma, a.client, (tx) => logNutrition(tx, a.client, b.clientId, { calories: 2000 })),
      ),
    ).toBe('NOT_FOUND:');
    expect(
      await err(
        runAs(prisma, a.coach, (tx) =>
          setNutritionTarget(tx, a.coach, a.clientId, { calories: 100 }),
        ),
      ),
    ).toBe('VALIDATION:calories');
  });
});
