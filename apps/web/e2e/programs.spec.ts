import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { signUpVerifiedCoach } from './helpers/users';

async function createProgram(page: Page, title: string): Promise<void> {
  await page.goto('/app/programs');
  await expect(page.getByRole('heading', { name: 'Programs', level: 1 })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'New program' });
  // Under a busy full run the server-rendered button can be clicked before it hydrates: click until it opens.
  await expect(async () => {
    await page.getByRole('button', { name: 'New program' }).first().click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
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

const save = (page: Page) => page.getByRole('button', { name: 'Save changes', exact: true });

test.describe('program builder', () => {
  test('coach creates a 1-week x 2-day program with 3 exercises and saves; reload shows identical content', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Strength block');
    await expect(page.getByText('Not saved yet')).toBeVisible();

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
    await expect(page.getByText('Saved as version 1')).toBeVisible({ timeout: 30_000 });

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

  test('second tab save after first -> conflict notice, draft kept, reload latest', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Conflict test');
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await addExercise(day, page, 'bench', 'Barbell Bench Press');
    await save(page).click();
    await expect(page.getByText('Saved as version 1')).toBeVisible({ timeout: 30_000 });

    const second = await page.context().newPage();
    await second.goto(page.url());
    const day2 = second.getByRole('group', { name: 'Day 1', exact: true });
    // Wait for hydration: the field is filled from form state on the client.
    await expect(day2.getByLabel('Day title')).toHaveValue('Day 1');
    await day2.getByLabel('Day title').fill('Second tab wins');
    await save(second).click();
    await expect(second.getByText('Saved as version 2')).toBeVisible({ timeout: 30_000 });

    await day.getByLabel('Day title').fill('First tab loses');
    await save(page).click();
    await expect(
      page.getByText('A newer version (version 2) was saved. Your draft is kept.'),
    ).toBeVisible();
    await expect(day.getByLabel('Day title')).toHaveValue('First tab loses');

    await page.getByRole('button', { name: 'Reload latest' }).click();
    const confirm = page.getByRole('dialog', { name: 'Reload the latest version?' });
    await expect(confirm.getByText('Reloading discards your draft.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Reload latest' }).click();
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(day.getByLabel('Day title')).toHaveValue('Second tab wins');
  });

  test('conflict -> "Keep my draft" rebases; the next explicit save commits it', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Keep mine');
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await addExercise(day, page, 'bench', 'Barbell Bench Press');
    await save(page).click();
    await expect(page.getByText('Saved as version 1')).toBeVisible({ timeout: 30_000 });

    const second = await page.context().newPage();
    await second.goto(page.url());
    const day2 = second.getByRole('group', { name: 'Day 1', exact: true });
    await expect(day2.getByLabel('Day title')).toHaveValue('Day 1');
    await day2.getByLabel('Day title').fill('Other tab');
    await save(second).click();
    await expect(second.getByText('Saved as version 2')).toBeVisible({ timeout: 30_000 });
    await second.close();

    await day.getByLabel('Day title').fill('Mine on top');
    await save(page).click();
    const notice = page.getByText('A newer version (version 2) was saved. Your draft is kept.');
    await expect(notice).toBeVisible();
    await page.getByRole('button', { name: 'Keep my draft' }).click();
    await expect(notice).toBeHidden();
    // Nothing was committed by keeping the draft.
    await expect(page.getByText('Version 2', { exact: true })).toHaveCount(0);
    await save(page).click();
    await expect(page.getByText('Saved as version 3')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(day.getByLabel('Day title')).toHaveValue('Mine on top');
    await expect(page.getByText('Version 3', { exact: true })).toBeVisible();
    await expect(page.getByText('Restored your unsaved draft.')).toHaveCount(0);
  });

  test('autosave: offline keeps the draft on the device, then syncs when back online', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Offline draft');
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await day.getByLabel('Day title').fill('Typed online');
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible({
      timeout: 30_000,
    });

    await page.context().setOffline(true);
    await day.getByLabel('Day title').fill('Typed offline');
    await expect(page.getByText('Offline – draft kept on this device')).toBeVisible();
    const local = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('kinetic:program-draft:')),
    );
    expect(local).toHaveLength(1);

    await page.context().setOffline(false);
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved' })).toBeVisible({
      timeout: 30_000,
    });
    await page.reload();
    await expect(page.getByText('Restored your unsaved draft.')).toBeVisible();
    await expect(day.getByLabel('Day title')).toHaveValue('Typed offline');
  });

  test('editor is locked while a save is in flight', async ({ page, request }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Locked save');
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await addExercise(day, page, 'bench', 'Barbell Bench Press');

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route('**/api/v1/programs/*', async (route) => {
      if (route.request().method() === 'PATCH') await gate;
      await route.continue();
    });
    await save(page).click();
    await expect(day.getByLabel('Day title')).toBeDisabled();
    await expect(save(page).or(page.getByRole('button', { name: 'Saving...' }))).toBeDisabled();
    release();
    await expect(page.getByText('Saved as version 1')).toBeVisible({ timeout: 30_000 });
    await expect(day.getByLabel('Day title')).toBeEnabled();
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

  test('keyboard-only reorder: Enter on "Move … down" moves the card and keeps focus on it', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Reorder');
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await addExercise(day, page, 'bench', 'Barbell Bench Press');
    await addExercise(day, page, 'plank', 'Plank');
    const names = () => day.getByRole('heading', { level: 4 }).allTextContents();
    expect(await names()).toEqual(['Barbell Bench Press', 'Plank']);

    // Keyboard only: Tab from the day title until "Move Barbell Bench Press down" has focus.
    await day.getByLabel('Day title').focus();
    const target = 'Move Barbell Bench Press down';
    for (let i = 0; i < 20; i++) {
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (label === target) break;
      await page.keyboard.press('Tab');
    }
    await expect(day.getByRole('button', { name: target })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(names).toEqual(['Plank', 'Barbell Bench Press']);
    // Now last, "down" is disabled, so focus stays on the moved card's "up" button.
    const bench = day.getByRole('group', { name: 'Barbell Bench Press' });
    await expect(bench.getByRole('button', { name: 'Move Barbell Bench Press up' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(names).toEqual(['Barbell Bench Press', 'Plank']);
    await expect(
      bench.getByRole('button', { name: 'Move Barbell Bench Press down' }),
    ).toBeFocused();

    // Days reorder within the week the same way.
    await page.getByRole('button', { name: 'More days' }).click();
    const day2 = page.getByRole('group', { name: 'Day 2', exact: true });
    await day2.getByLabel('Day title').fill('Lower');
    await day2.getByRole('button', { name: 'Move Lower up' }).focus();
    await page.keyboard.press('Enter');
    await expect(day.getByLabel('Day title')).toHaveValue('Lower');
    await expect(day.getByRole('button', { name: 'Move Lower down' })).toBeFocused();
    await expect(day2.getByRole('group', { name: 'Plank' })).toBeVisible();
  });

  test('duplicate week then save shows 2 weeks; remove week asks first', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Weeks');
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await day.getByLabel('Day title').fill('Push');
    await addExercise(day, page, 'bench', 'Barbell Bench Press');
    await expect(page.getByRole('button', { name: 'Remove week 1' })).toBeDisabled();

    await page.getByRole('button', { name: 'Duplicate week 1' }).click();
    await expect(page.getByRole('tab', { name: 'Week 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('button', { name: 'Duplicate week 2' }).click();
    await expect(page.getByRole('tab')).toHaveCount(3);

    await page.getByRole('button', { name: 'Remove week 3' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove week 3?' });
    await confirm.getByRole('button', { name: 'Keep week' }).click();
    await expect(page.getByRole('tab')).toHaveCount(3);
    await page.getByRole('button', { name: 'Remove week 3' }).click();
    await confirm.getByRole('button', { name: 'Remove week' }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);

    await save(page).click();
    await expect(page.getByText('Saved as version 1')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await page.getByRole('tab', { name: 'Week 2' }).click();
    await expect(day.getByLabel('Day title')).toHaveValue('Push');
    await expect(day.getByRole('group', { name: 'Barbell Bench Press' })).toBeVisible();

    // The templates list shows the shape and that nobody runs it yet.
    await page.goto('/app/programs');
    const row = page.getByRole('listitem').filter({ hasText: 'Weeks' });
    await expect(row.getByText('2 weeks · 1 day per week · Version 1')).toBeVisible();
    await expect(row.getByText('Not assigned')).toBeVisible();
  });

  test('notes and tempo persist after save; fewer days asks before dropping content', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Notes');
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await addExercise(day, page, 'bench', 'Barbell Bench Press');
    const bench = day.getByRole('group', { name: 'Barbell Bench Press' });
    await day.getByLabel('Day notes').fill('Warm up 10 minutes.');
    await bench.getByLabel('Exercise note').fill('Pause on the chest.');
    await bench.getByRole('group', { name: 'Set 1' }).getByLabel('Tempo').fill('31X1');

    await page.getByRole('button', { name: 'More days' }).click();
    const day2 = page.getByRole('group', { name: 'Day 2', exact: true });
    await addExercise(day2, page, 'plank', 'Plank');
    await page.getByRole('button', { name: 'Fewer days' }).click();
    const fewer = page.getByRole('dialog', { name: 'Remove day 2 from every week?' });
    await expect(fewer.getByText('Its exercises will be lost.')).toBeVisible();
    await expectNoAxeViolations(page);
    await fewer.getByRole('button', { name: 'Keep day' }).click();
    await expect(page.getByText('2 days per week')).toBeVisible();
    await page.getByRole('button', { name: 'Fewer days' }).click();
    await fewer.getByRole('button', { name: 'Remove day' }).click();
    await expect(page.getByText('1 day per week')).toBeVisible();

    await save(page).click();
    await expect(page.getByText('Saved as version 1')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(day.getByLabel('Day notes')).toHaveValue('Warm up 10 minutes.');
    await expect(bench.getByLabel('Exercise note')).toHaveValue('Pause on the chest.');
    await expect(bench.getByRole('group', { name: 'Set 1' }).getByLabel('Tempo')).toHaveValue(
      '31X1',
    );
  });

  test('copy workout to another day (axe on the open dialog); errors map to their fields (axe)', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, 'Copying');
    await page.getByRole('button', { name: 'More days' }).click();
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    const day2 = page.getByRole('group', { name: 'Day 2', exact: true });
    await day.getByLabel('Day title').fill('Upper');
    await addExercise(day, page, 'bench', 'Barbell Bench Press');

    await day.getByRole('button', { name: 'Copy workout to…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Copy workout to…' });
    await expect(dialog.getByLabel('Week')).toHaveValue('0');
    await expect(dialog.getByLabel('Day', { exact: true })).toHaveValue('1');
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Copy' }).click();
    const replace = page.getByRole('dialog', { name: 'Replace Day 2?' });
    await expect(replace).toBeVisible();
    await expectNoAxeViolations(page);
    await replace.getByRole('button', { name: 'Replace' }).click();
    await expect(replace).toBeHidden();
    await expect(day2.getByLabel('Day title')).toHaveValue('Upper');
    await expect(day2.getByRole('group', { name: 'Barbell Bench Press' })).toBeVisible();

    // Client-side validation state.
    await day2.getByLabel('Day title').fill('');
    await save(page).click();
    await expect(day2.getByText('Enter a day title.')).toBeVisible();
    await expect(
      page.getByText('Some fields need attention. Fix them and save again.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await day2.getByLabel('Day title').fill('Lower');

    // A server-side 422 lands on the field its path names; the rest shows above the form.
    await page.route('**/api/v1/programs/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'VALIDATION',
            message: 'Some fields are invalid.',
            fieldErrors: {
              weeks: [
                '0.days.1.exercises.0.sets.0.tempo: Use four characters, each 0-9 or X.',
                'Every week must have the same number of training days.',
              ],
            },
          },
        }),
      });
    });
    await save(page).click();
    const tempo = day2
      .getByRole('group', { name: 'Barbell Bench Press' })
      .getByRole('group', { name: 'Set 1' })
      .getByLabel('Tempo');
    await expect(tempo).toHaveAttribute('aria-invalid', 'true');
    await expect(day2.getByText('Use four characters, each 0-9 or X.')).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Every week must have the same number' }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  for (const vp of [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
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
