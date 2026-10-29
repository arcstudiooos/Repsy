import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedCoach } from './helpers/users';

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('exercise library', () => {
  test('coach searches, filters, and adds a custom exercise', async ({ page, request }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/exercises');
    await expect(page.getByRole('heading', { name: 'Exercise library', level: 1 })).toBeVisible();
    const list = page.getByRole('list', { name: 'Exercises' });
    await expect(list.getByRole('heading', { name: 'Barbell Bench Press' })).toBeVisible();

    await page.getByLabel('Search exercises').fill('romanian');
    await expect(page).toHaveURL(/q=romanian/);
    await expect(list.getByRole('heading')).toHaveText(['Romanian Deadlift']);

    await page.getByLabel('Search exercises').fill('');
    await page.getByLabel('Filter by tracking type').selectOption('distance');
    await expect(page).toHaveURL(/trackingType=distance/);
    await expect(list.getByRole('heading', { name: 'Outdoor Run' })).toBeVisible();
    await expect(list.getByRole('heading', { name: 'Plank' })).toHaveCount(0);

    await page.getByLabel('Search exercises').fill('zzzz-no-such-thing');
    await expect(page.getByRole('heading', { name: 'No exercises match' })).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(list.getByRole('heading', { name: 'Barbell Bench Press' })).toBeVisible();

    await page.getByRole('button', { name: 'Add exercise' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add exercise' });
    await dialog.getByLabel('Name').fill('Sandbag Shouldering');
    await dialog.getByLabel('What is tracked').selectOption('reps_load');
    await dialog.getByRole('button', { name: 'Add exercise' }).click();
    await expect(dialog).toBeHidden();

    await page.getByLabel('Search exercises').fill('sandbag');
    await expect(list.getByRole('heading', { name: 'Sandbag Shouldering' })).toBeVisible();
    await expect(list.getByText('Custom')).toBeVisible();

    // The same name again is a field-level conflict, not a crash.
    await page.getByRole('button', { name: 'Add exercise' }).click();
    const again = page.getByRole('dialog', { name: 'Add exercise' });
    await again.getByLabel('Name').fill('sandbag shouldering');
    await again.getByRole('button', { name: 'Add exercise' }).click();
    await expect(again.getByText('You already have an exercise with this name.')).toBeVisible();
  });

  for (const vp of VIEWPORTS) {
    test(`library and add dialog are axe-clean at ${vp.width}`, async ({ page, request }) => {
      await page.setViewportSize(vp);
      await signUpVerifiedCoach(page, request);
      await page.goto('/app/exercises');
      await expect(page.getByRole('heading', { name: 'Exercise library', level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);

      await page.getByRole('button', { name: 'Add exercise' }).click();
      await expect(page.getByRole('dialog', { name: 'Add exercise' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});
