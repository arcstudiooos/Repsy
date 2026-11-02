import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { recordMedia } from '../media/media';
import { newClientWorld, newOrg, runAs } from '../sessions/fixtures.test-helpers';
import {
  archiveMealPlan,
  archiveRecipe,
  clientMealPlan,
  getRecipe,
  listMealPlans,
  saveMealPlan,
  saveRecipe,
  setClientMealPlan,
  shoppingList,
} from './mealPlans';

let prisma: PrismaClient;
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('shopping list (PRD G8)', () => {
  it('scales each recipe to its servings and adds up the same ingredient', () => {
    const recipes = new Map([
      [
        'r1',
        {
          servings: 2,
          ingredients: [
            { name: 'Oats', amount: 100, unit: 'g' },
            { name: 'Salt', amount: null, unit: '' },
          ],
        },
      ],
      ['r2', { servings: 1, ingredients: [{ name: 'oats', amount: 40, unit: 'g' }] }],
    ]);
    const days = [
      {
        meals: [
          {
            options: [
              { recipeId: 'r1', servings: 1 },
              { recipeId: 'r2', servings: 1 },
            ],
          },
        ],
      },
      {
        meals: [{ options: [{ recipeId: 'r2', servings: 2 }] }, { options: [{ recipeId: null }] }],
      },
    ];
    expect(shoppingList(days, recipes)).toEqual([
      { name: 'Oats', amount: 130, unit: 'g' },
      { name: 'Salt', amount: null, unit: '' },
    ]);
  });
});

describe('recipes and meal plans (PRD G8, G9)', () => {
  it('builds a plan from recipes and options; the client sees it, its recipes and a shopping list', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const photo = await runAs(prisma, org.coach, (tx) =>
      recordMedia(tx, org.coach, {
        purpose: 'nutrition',
        clientId: null,
        contentType: 'image/jpeg',
        bytes: 10,
        key: `media/test/recipe-${Date.now()}`,
      }),
    );
    const { id: oatsId } = await runAs(prisma, org.coach, (tx) =>
      saveRecipe(tx, org.coach, {
        title: 'Overnight oats',
        servings: 2,
        ingredients: [
          { name: 'Rolled oats', amount: 100, unit: 'g' },
          { name: 'Milk', amount: 300, unit: 'ml' },
        ],
        steps: 'Mix, chill overnight.',
        calories: 320,
        proteinG: 14,
        carbsG: 50,
        fatG: 7,
        photoMediaId: photo.id,
      }),
    );
    await expect(
      runAs(prisma, org.coach, (tx) => saveMealPlan(tx, org.coach, { title: 'Empty', days: [] })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const { id: planId } = await runAs(prisma, org.coach, (tx) =>
      saveMealPlan(tx, org.coach, {
        title: 'Lean week',
        notes: 'Drink water with each meal.',
        days: [
          {
            name: 'Training day',
            meals: [
              {
                name: 'Breakfast',
                options: [
                  { recipeId: oatsId, servings: 1.5 },
                  { text: 'Greek yogurt and berries', calories: 250, proteinG: 20 },
                ],
              },
              { name: 'Lunch', options: [{ text: 'Chicken salad', calories: 500, proteinG: 45 }] },
            ],
          },
        ],
      }),
    );
    await runAs(prisma, org.coach, (tx) => setClientMealPlan(tx, org.coach, w.clientId, planId));

    const mine = await runAs(prisma, w.client, (tx) => clientMealPlan(tx, w.client));
    expect(mine!.plan.days[0]!.meals[0]!.options.map((o) => [o.title, o.calories])).toEqual([
      ['Overnight oats', 480],
      ['Greek yogurt and berries', 250],
    ]);
    expect(mine!.plan.days[0]!.totals).toEqual({
      calories: 980,
      proteinG: 66,
      carbsG: 75,
      fatG: 11,
    });
    expect(mine!.shopping).toEqual([
      { name: 'Milk', amount: 225, unit: 'ml' },
      { name: 'Rolled oats', amount: 75, unit: 'g' },
    ]);
    expect(await runAs(prisma, w.client, (tx) => getRecipe(tx, w.client, oatsId))).toMatchObject({
      title: 'Overnight oats',
      photoMediaId: photo.id,
    });

    // A recipe outside their plan is not theirs to open; another client sees no plan.
    const { id: otherRecipe } = await runAs(prisma, org.coach, (tx) =>
      saveRecipe(tx, org.coach, { title: 'Soup', servings: 1, ingredients: [] }),
    );
    await expect(
      runAs(prisma, w.client, (tx) => getRecipe(tx, w.client, otherRecipe)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const other = await newClientWorld(prisma, org);
    expect(await runAs(prisma, other.client, (tx) => clientMealPlan(tx, other.client))).toBeNull();
    await expect(
      runAs(prisma, other.client, (tx) => getRecipe(tx, other.client, oatsId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Clients can't build plans.
    await expect(
      runAs(prisma, w.client, (tx) => saveRecipe(tx, w.client, { title: 'x', servings: 1 })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // An archived recipe can't go in a new plan but still shows in this one.
    await runAs(prisma, org.coach, (tx) => archiveRecipe(tx, org.coach, oatsId));
    await expect(
      runAs(prisma, org.coach, (tx) =>
        saveMealPlan(tx, org.coach, {
          title: 'New',
          days: [{ name: 'D', meals: [{ name: 'B', options: [{ recipeId: oatsId }] }] }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(
      (await runAs(prisma, w.client, (tx) => clientMealPlan(tx, w.client)))!.plan.days[0]!.meals[0]!
        .options[0]!.title,
    ).toBe('Overnight oats');

    expect(await runAs(prisma, org.coach, (tx) => listMealPlans(tx, org.coach))).toMatchObject([
      { title: 'Lean week', assigned: 1 },
    ]);
    await runAs(prisma, org.coach, (tx) => archiveMealPlan(tx, org.coach, planId));
    expect(await runAs(prisma, w.client, (tx) => clientMealPlan(tx, w.client))).toBeNull();
  });

  it('accepts a PDF-only plan, and a client can read workspace nutrition files', async () => {
    const org = await newOrg(prisma);
    const w = await newClientWorld(prisma, org);
    const pdf = await runAs(prisma, org.coach, (tx) =>
      recordMedia(tx, org.coach, {
        purpose: 'nutrition',
        clientId: null,
        contentType: 'application/pdf',
        bytes: 10,
        key: `media/test/plan-${Date.now()}`,
      }),
    );
    const { id } = await runAs(prisma, org.coach, (tx) =>
      saveMealPlan(tx, org.coach, { title: 'From my dietitian', days: [], pdfMediaId: pdf.id }),
    );
    await runAs(prisma, org.coach, (tx) => setClientMealPlan(tx, org.coach, w.clientId, id));
    const mine = await runAs(prisma, w.client, (tx) => clientMealPlan(tx, w.client));
    expect(mine).toMatchObject({ plan: { pdfMediaId: pdf.id, days: [] }, shopping: [] });
    await runAs(prisma, org.coach, (tx) => setClientMealPlan(tx, org.coach, w.clientId, null));
    expect(await runAs(prisma, w.client, (tx) => clientMealPlan(tx, w.client))).toBeNull();
    const rows = await withSystem(
      (tx) => tx.clientMealPlan.count({ where: { clientId: w.clientId } }),
      prisma,
    );
    expect(rows).toBe(1);
  });
});
