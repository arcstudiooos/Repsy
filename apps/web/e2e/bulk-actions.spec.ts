import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('bulk actions (PRD B5)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('the coach tags, messages and assigns a program to several clients at once', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const ana = await onboardClient(page, request, browser, 'Ana Bulk');
    const ben = await onboardClient(page, request, browser, 'Ben Bulk');
    await ana.context.close();
    await ben.context.close();
    const origin = new URL(page.url()).origin;
    await page.request.post('/api/v1/tags', {
      data: { name: 'Spring group' },
      headers: { origin },
    });
    await buildProgram(page, 'Group block', [[['bench', 'Barbell Bench Press']]]);
    // Ana already has a program: bulk assign skips her.
    await assignFromClientTab(page, 'Ana Bulk', 'Group block', 1);

    await page.goto('/app/clients');
    await page.getByRole('checkbox', { name: 'Select Ana Bulk' }).check();
    await page.getByRole('checkbox', { name: 'Select Ben Bulk' }).check();
    const bar = page.getByRole('region', { name: '2 clients selected' });
    await expect(bar).toBeVisible();
    await expectNoAxeViolations(page);

    await bar.getByLabel('Tag to add').selectOption({ label: 'Spring group' });
    await bar.getByRole('button', { name: 'Add tag' }).click();
    await expect(page.getByText('Tagged 2 clients')).toBeVisible({ timeout: 15_000 });

    await bar.getByRole('button', { name: 'Message' }).click();
    const msg = page.getByRole('dialog', { name: 'Message 2 clients' });
    await msg.getByLabel('Message', { exact: true }).fill('Group session moves to Saturday.');
    await msg.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Sent to 2 clients')).toBeVisible({ timeout: 15_000 });

    await bar.getByRole('button', { name: 'Assign program' }).click();
    const assign = page.getByRole('dialog', { name: 'Assign a program to 2 clients' });
    await assign
      .getByLabel('Program', { exact: true })
      .selectOption({ label: 'Group block (1 day a week)' });
    await assign.getByRole('checkbox', { name: 'Monday' }).check();
    await assign
      .getByRole('checkbox', {
        name: "I've confirmed these clients are ready to start this program.",
      })
      .check();
    await expectNoAxeViolations(page);
    await assign.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(assign.getByText('Assigned to 1 client.')).toBeVisible({ timeout: 30_000 });
    await expect(assign.getByRole('list', { name: 'Skipped clients' })).toContainText('Ana Bulk');
    await page.keyboard.press('Escape');

    // Both now carry the tag; Ben has his own copy of the program.
    await expect(page.getByRole('row', { name: /Ben Bulk/ })).toContainText('Spring group', {
      timeout: 30_000,
    });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
    }
    await page.goto('/app/clients');
    await page.getByRole('link', { name: 'Ben Bulk' }).first().click();
    await page
      .getByRole('navigation', { name: 'Client sections' })
      .getByRole('link', { name: 'Program', exact: true })
      .click();
    await expect(page.getByText('Group block').first()).toBeVisible({ timeout: 30_000 });
  });
});
