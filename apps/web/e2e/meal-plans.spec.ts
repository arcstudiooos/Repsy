import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('recipes and meal plans (PRD G8, G9)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach builds a plan from a recipe; the client follows it with a shopping list', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Mia Meals');
    const portal = client.page;
    try {
      await page.goto('/app/meal-plans');
      await page.getByRole('link', { name: 'New recipe' }).click();
      await page.getByLabel('Recipe name').fill('Overnight oats');
      await page.getByLabel('Servings it makes').fill('2');
      await page.getByLabel('Ingredient 1', { exact: true }).fill('Rolled oats');
      await page.getByLabel('Amount 1', { exact: true }).fill('100');
      await page.getByLabel('Unit 1', { exact: true }).fill('g');
      await page.getByRole('button', { name: 'Add an ingredient' }).click();
      await page.getByLabel('Ingredient 2', { exact: true }).fill('Milk');
      await page.getByLabel('Amount 2', { exact: true }).fill('300');
      await page.getByLabel('Unit 2', { exact: true }).fill('ml');
      await page.getByLabel('Steps').fill('Mix and chill overnight.');
      await page.getByLabel('Calories (kcal)').fill('320');
      await page.getByLabel('Protein (g)').fill('14');
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Save recipe' }).click();
      await expect(page).toHaveURL(/\/app\/meal-plans$/, { timeout: 30_000 });
      await expect(page.getByRole('link', { name: 'Overnight oats' })).toBeVisible();

      await page.getByRole('link', { name: 'New meal plan' }).click();
      await page.getByLabel('Meal plan name').fill('Lean week');
      // Day 1 starts with breakfast, lunch and dinner, each with the first recipe.
      await page
        .getByLabel('Day 1 meal 3 option 1', { exact: true })
        .selectOption({ label: 'Described' });
      await page.getByLabel('Day 1 meal 3 option 1 description').fill('Chicken salad');
      await page.getByLabel('Day 1 meal 3 option 1 kcal').fill('500');
      await page.getByRole('button', { name: 'Add a swap option to day 1 meal 1' }).click();
      await page.getByLabel('Day 1 meal 1 option 2 description').fill('Greek yogurt and berries');
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Save meal plan' }).click();
      await expect(page).toHaveURL(/\/app\/meal-plans$/, { timeout: 30_000 });
      await expect(page.getByRole('link', { name: 'Lean week' })).toBeVisible();

      await openClientTab(page, 'Mia Meals', 'Nutrition');
      await page.getByLabel('Meal plan', { exact: true }).selectOption({ label: 'Lean week' });
      const saved = page.waitForResponse(
        (r) => r.url().includes('/meal-plan') && r.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: 'Save meal plan' }).click();
      expect((await saved).status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Meal plan: Lean week' })).toBeVisible({
        timeout: 15_000,
      });

      await portal.goto('/portal/nutrition');
      await portal.getByRole('link', { name: 'Your meal plan: Lean week' }).click();
      await expect(portal).toHaveURL(/\/portal\/meals$/);
      await expect(portal.getByText('Greek yogurt and berries')).toBeVisible();
      const list = portal.getByRole('list', { name: 'Shopping list' });
      await expect(list.getByText('Rolled oats: 100 g')).toBeVisible();
      await expect(list.getByText('Milk: 300 ml')).toBeVisible();
      await list.getByText('Milk: 300 ml').click();
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }
      await portal.getByRole('link', { name: 'Overnight oats' }).first().click();
      await expect(portal.getByRole('heading', { name: 'Overnight oats' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(portal.getByText('Mix and chill overnight.')).toBeVisible();
      await expectNoAxeViolations(portal);
    } finally {
      await client.context.close();
    }
  });
});
