import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { newClientWorld, newOrg, runAs, type ClientWorld } from '../sessions/fixtures.test-helpers';
import {
  applyAiAction,
  cancelAiAction,
  linkAiActions,
  listAiActions,
  markAiActionFailed,
  mealPlanMisses,
  runActionTool,
} from './actions';
import { createAiConversation } from './conversations';
import { setAiActionsEnabled, setAiSetting } from './settings';

/** PRD I15 actions: propose, check, confirm, cancel. */
let prisma: PrismaClient;
let drop: () => Promise<void>;
let w: ClientWorld;
let other: ClientWorld;
let conversationId: string;

const TARGETS = { calories: 2000, proteinG: 150, carbsG: 200, fatG: 67 };
const meal = (name: string, kcal: number, p: number, c: number, f: number) => ({
  name,
  options: [
    {
      recipeId: null,
      servings: null,
      text: `${name} plate`,
      calories: kcal,
      proteinG: p,
      carbsG: c,
      fatG: f,
    },
  ],
});
const goodDay = (name: string) => ({
  name,
  meals: [
    meal('Breakfast', 500, 40, 50, 16),
    meal('Lunch', 750, 55, 75, 26),
    meal('Dinner', 750, 55, 75, 25),
  ],
});

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  w = await newClientWorld(prisma, await newOrg(prisma));
  other = await newClientWorld(prisma, await newOrg(prisma));
  conversationId = await as(w.coach, async (tx) => {
    await setAiSetting(tx, w.coach, true);
    return createAiConversation(tx, w.coach, 'Set Client up');
  });
});
afterAll(async () => {
  await drop();
});

function as<T>(actor: ActorContext, fn: Parameters<typeof runAs<T>>[2]) {
  return runAs(prisma, actor, fn);
}
const propose = (name: string, input: unknown, actor = w.coach) =>
  as(actor, (tx) => runActionTool(tx, actor, name, input, { conversationId }));

describe('assistant actions', () => {
  it('refuses to propose while actions are off', async () => {
    const res = await propose('propose_nutrition_targets', {
      clientId: w.clientId,
      targets: TARGETS,
      effectiveFrom: null,
    });
    expect(res).toMatchObject({ ok: false });
    expect(res.content).toMatch(/turned off/);
  });

  it('checks macros add up, then stores a proposal that changes nothing until confirmed', async () => {
    await as(w.coach, (tx) => setAiActionsEnabled(tx, w.coach, true));
    const bad = await propose('propose_nutrition_targets', {
      clientId: w.clientId,
      targets: { calories: 2000, proteinG: 300, carbsG: 300, fatG: 100 },
      effectiveFrom: null,
    });
    expect(bad.ok).toBe(false);

    const res = await propose('propose_nutrition_targets', {
      clientId: w.clientId,
      targets: TARGETS,
      effectiveFrom: null,
    });
    expect(res.ok).toBe(true);
    const before = await as(w.coach, (tx) =>
      tx.nutritionTarget.count({ where: { clientId: w.clientId } }),
    );
    expect(before).toBe(0);

    const applied = await as(w.coach, (tx) => applyAiAction(tx, w.coach, res.actionId!));
    expect(applied.status).toBe('applied');
    const target = await as(w.coach, (tx) =>
      tx.nutritionTarget.findFirst({ where: { clientId: w.clientId } }),
    );
    expect(target).toMatchObject({ calories: 2000, proteinG: 150 });
    await expect(
      as(w.coach, (tx) => applyAiAction(tx, w.coach, res.actionId!)),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a meal plan whose days miss the targets, with how far off', async () => {
    const lowDay = { name: 'Tuesday', meals: [meal('Lunch', 900, 60, 90, 30)] };
    const res = await propose('propose_meal_plan', {
      clientId: w.clientId,
      title: 'Week 1',
      notes: '',
      targets: TARGETS,
      alsoSetTargets: false,
      days: [goodDay('Monday'), lowDay],
    });
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/Tuesday: calories 900/);
    expect(res.content).not.toMatch(/Monday/);
  });

  it('builds and gives a meal plan on confirm', async () => {
    const res = await propose('propose_meal_plan', {
      clientId: w.clientId,
      title: 'Week 1',
      notes: 'Drink water',
      targets: TARGETS,
      alsoSetTargets: true,
      days: ['Monday', 'Tuesday', 'Wednesday'].map(goodDay),
    });
    expect(res.ok).toBe(true);
    await as(w.coach, (tx) => applyAiAction(tx, w.coach, res.actionId!));
    const plan = await as(w.coach, (tx) =>
      tx.clientMealPlan.findFirst({
        where: { clientId: w.clientId, endedAt: null },
        select: { mealPlan: { select: { title: true, daysJson: true } } },
      }),
    );
    expect(plan?.mealPlan.title).toBe('Week 1');
    expect((plan?.mealPlan.daysJson as unknown[]).length).toBe(3);
  });

  it('assigns a program on confirm, replacing the current one', async () => {
    const wrongDays = await propose('propose_assign_program', {
      clientId: w.clientId,
      templateProgramId: w.templateId,
      startDate: '2027-01-04',
      weekdays: [1, 3],
    });
    expect(wrongDays.ok).toBe(false);
    expect(wrongDays.content).toMatch(/3 days a week/);

    const res = await propose('propose_assign_program', {
      clientId: w.clientId,
      templateProgramId: w.templateId,
      startDate: '2027-01-04',
      weekdays: [5, 1, 3],
    });
    expect(res.ok).toBe(true);
    const [action] = (await as(w.coach, (tx) => listAiActions(tx, w.coach, conversationId))).filter(
      (a) => a.id === res.actionId,
    );
    expect(action!.summary).toMatch(/replaces "Block"/);
    expect(action!.details).toMatchObject({ weekdays: [1, 3, 5] });

    await as(w.coach, (tx) => applyAiAction(tx, w.coach, res.actionId!));
    const active = await as(w.coach, (tx) =>
      tx.programAssignment.findMany({ where: { clientId: w.clientId, status: 'active' } }),
    );
    expect(active).toHaveLength(1);
    expect(active[0]!.id).not.toBe(w.assignmentId);
  });

  it('cancel, fail and link; another workspace and clients cannot act', async () => {
    const res = await propose('propose_assign_meal_plan', {
      clientId: other.clientId,
      mealPlanId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res).toMatchObject({ ok: false });
    expect(res.content).toMatch(/No client/);

    const a = await propose('propose_nutrition_targets', {
      clientId: w.clientId,
      targets: TARGETS,
      effectiveFrom: null,
    });
    const msg = await as(w.coach, (tx) =>
      tx.aiMessage.create({
        data: { conversationId, role: 'assistant', body: 'Proposed.' },
        select: { id: true },
      } as never),
    );
    await as(w.coach, (tx) =>
      linkAiActions(tx, w.coach, [a.actionId!], (msg as { id: string }).id),
    );
    expect((await as(w.coach, (tx) => cancelAiAction(tx, w.coach, a.actionId!))).status).toBe(
      'cancelled',
    );

    const b = await propose('propose_nutrition_targets', {
      clientId: w.clientId,
      targets: TARGETS,
      effectiveFrom: null,
    });
    await as(w.coach, (tx) => markAiActionFailed(tx, w.coach, b.actionId!, 'Boom'));
    const all = await as(w.coach, (tx) => listAiActions(tx, w.coach, conversationId));
    expect(all.find((x) => x.id === a.actionId)).toMatchObject({
      status: 'cancelled',
      messageId: (msg as { id: string }).id,
    });
    expect(all.find((x) => x.id === b.actionId)).toMatchObject({ status: 'failed', error: 'Boom' });

    await expect(
      as(other.coach, (tx) => applyAiAction(tx, other.coach, b.actionId!)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await propose('propose_nutrition_targets', {}, w.client)).ok).toBe(false);
  });

  it('mealPlanMisses allows 5% calories and 10% or 5 g per macro', () => {
    const t = { calories: 2000, proteinG: 30, carbsG: 200, fatG: 60 };
    expect(
      mealPlanMisses(t, [{ calories: 2099, proteinG: 35, carbsG: 219, fatG: 54 }], ['D']),
    ).toEqual([]);
    expect(
      mealPlanMisses(t, [{ calories: 2101, proteinG: 36, carbsG: 200, fatG: 60 }], ['D']),
    ).toEqual(['D: calories 2101 (+101), proteinG 36 (+6)']);
  });
});
