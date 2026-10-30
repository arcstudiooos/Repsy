import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { signUpVerifiedCoach } from './helpers/users';

async function createProgram(page: Page, title: string): Promise<void> {
  await page.goto('/app/programs');
  await expect(page.getByRole('heading', { name: 'Programs', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New program' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New program' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Create program' }).click();
  await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/edit$/, {
    timeout: 30_000,
  });
  await expect(page.getByLabel('Program title')).toHaveValue(title);
}

async function addExercise(day: Locator, page: Page, search: string, name: string): Promise<void> {
  await day.getByRole('button', { name: 'Add exercise' }).click();
  const picker = page.getByRole('dialog', { name: 'Add exercise' });
  await picker.getByLabel('Search exercises').fill(search);
  await picker.getByRole('button', { name: `Add ${name}` }).click();
  await expect(picker).toBeHidden();
  await expect(day.getByRole('group', { name })).toBeVisible();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });

test.describe('program builder', () => {
  test('coach creates a 1-week x 2-day program with 3 exercises and saves; reload shows identical content', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Strength block');
    await expect(page.getByText('Save to keep changes')).toBeVisible();

    await page.getByRole('button', { name: 'More days' }).click();
    await expect(page.getByText('2 days per week')).toBeVisible();

    const day1 = page.getByRole('group', { name: 'Day 1', exact: true });
    const day2 = page.getByRole('group', { name: 'Day 2', exact: true });
    await day1.getByLabel('Day title').fill('Upper');
    await day2.getByLabel('Day title').fill('Lower');
    await addExercise(day1, page, 'bench', 'Barbell Bench Press');
    await addExercise(day1, page, 'plank', 'Plank');
    await addExercise(day2, page, 'romanian', 'Romanian Deadlift');

    const bench = day1.getByRole('group', { name: 'Barbell Bench Press' });
    await bench.getByRole('group', { name: 'Set 1' }).getByLabel('Reps').fill('5');
    await bench.getByRole('group', { name: 'Set 1' }).getByLabel('Load (kg)').fill('60');
    await bench.getByRole('button', { name: 'Add set' }).click();
    await bench.getByRole('group', { name: 'Set 2' }).getByLabel('RPE').fill('8');

    await save(page).click();
    await expect(page.getByText('Saved as version 1')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Program title')).toHaveValue('Strength block');
    await expect(page.getByText('2 days per week')).toBeVisible();
    await expect(day1.getByLabel('Day title')).toHaveValue('Upper');
    await expect(day2.getByLabel('Day title')).toHaveValue('Lower');
    await expect(day1.getByRole('group', { name: 'Plank' })).toBeVisible();
    await expect(day2.getByRole('group', { name: 'Romanian Deadlift' })).toBeVisible();
    const benchAfter = day1.getByRole('group', { name: 'Barbell Bench Press' });
    const set1 = benchAfter.getByRole('group', { name: 'Set 1' });
    await expect(set1.getByLabel('Reps')).toHaveValue('5');
    await expect(set1.getByLabel('Load (kg)')).toHaveValue('60');
    await expect(benchAfter.getByRole('group', { name: 'Set 2' }).getByLabel('RPE')).toHaveValue(
      '8',
    );
  });

  test('second tab save after first -> conflict notice, nothing overwritten', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Conflict test');
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await addExercise(day, page, 'bench', 'Barbell Bench Press');
    await save(page).click();
    await expect(page.getByText('Saved as version 1')).toBeVisible();

    const second = await page.context().newPage();
    await second.goto(page.url());
    const day2 = second.getByRole('group', { name: 'Day 1', exact: true });
    // Wait for hydration: the field is filled from form state on the client.
    await expect(day2.getByLabel('Day title')).toHaveValue('Day 1');
    await day2.getByLabel('Day title').fill('Second tab wins');
    await save(second).click();
    await expect(second.getByText('Saved as version 2')).toBeVisible();

    await day.getByLabel('Day title').fill('First tab loses');
    await save(page).click();
    await expect(
      page.getByText('This program changed in another tab. Reload to see the latest version.'),
    ).toBeVisible();
    await expect(day.getByLabel('Day title')).toHaveValue('First tab loses');

    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(day.getByLabel('Day title')).toHaveValue('Second tab wins');
  });

  test('duration exercise shows duration field not reps', async ({ page, request }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Tracking types');
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await addExercise(day, page, 'plank', 'Plank');
    const set = day.getByRole('group', { name: 'Plank' }).getByRole('group', { name: 'Set 1' });
    await expect(set.getByLabel('Duration (s)')).toBeVisible();
    await expect(set.getByLabel('Reps')).toHaveCount(0);
    await expect(set.getByLabel('Load (kg)')).toHaveCount(0);

    await addExercise(day, page, 'outdoor run', 'Outdoor Run');
    const run = day
      .getByRole('group', { name: 'Outdoor Run' })
      .getByRole('group', { name: 'Set 1' });
    await expect(run.getByLabel('Distance (m)')).toBeVisible();
    await expect(run.getByLabel('Reps')).toHaveCount(0);
  });

  for (const vp of [
    { width: 375, height: 812 },
    { width: 1440, height: 900 },
  ] as const) {
    test(`editor axe-clean at ${vp.width}; keyboard can add a set`, async ({ page, request }) => {
      await page.setViewportSize(vp);
      await signUpVerifiedCoach(page, request);
      await page.goto('/app/programs');
      await expect(page.getByRole('link', { name: 'Exercise library' })).toBeVisible();
      await expectNoAxeViolations(page);
      await createProgram(page, `A11y ${vp.width}`);
      const day = page.getByRole('group', { name: 'Day 1', exact: true });
      await addExercise(day, page, 'bench', 'Barbell Bench Press');
      await day.getByRole('button', { name: 'Add set' }).focus();
      await page.keyboard.press('Enter');
      await expect(day.getByRole('group', { name: 'Set 2' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expectNoAxeViolations(page);
    });
  }
});
