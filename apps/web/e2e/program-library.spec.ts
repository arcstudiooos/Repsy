import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

async function createProgram(page: Page, baseURL: string, title: string) {
  const res = await page.request.post('/api/v1/programs', {
    data: { title },
    headers: { origin: new URL(baseURL).origin },
  });
  expect(res.status()).toBe(201);
}

test.describe('template library (PRD C13)', () => {
  test('duplicate, search, archive and restore templates', async ({ page, request, baseURL }) => {
    await signUpVerifiedCoach(page, request);
    await createProgram(page, baseURL as string, 'Upper Lower');
    await createProgram(page, baseURL as string, 'Glute Focus');
    await page.goto('/app/programs');
    const list = page.getByRole('list', { name: 'Programs' });
    await expect(list.getByText('Upper Lower')).toBeVisible();

    // Duplicate opens the copy in the builder.
    await page.getByRole('button', { name: 'Duplicate Upper Lower' }).click();
    await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });
    await page.goto('/app/programs');
    await expect(list.getByText('Copy of Upper Lower')).toBeVisible();

    // Search narrows the list.
    await page.getByRole('searchbox', { name: 'Search programs' }).fill('glute');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/q=glute/);
    await expect(list.getByText('Glute Focus')).toBeVisible();
    await expect(list.getByText('Upper Lower')).toHaveCount(0);

    // Archive moves it to the Archived view; restore brings it back.
    await page.getByRole('button', { name: 'Archive Glute Focus' }).click();
    await expect(page.getByRole('heading', { name: 'No programs match' })).toBeVisible({
      timeout: 15_000,
    });
    await page.goto('/app/programs?status=archived');
    await expect(list.getByText('Glute Focus')).toBeVisible();
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);
    }
    await page.getByRole('button', { name: 'Restore Glute Focus' }).click();
    await expect(page.getByRole('heading', { name: 'No archived programs' })).toBeVisible({
      timeout: 15_000,
    });
    await page.goto('/app/programs');
    await expect(list.getByText('Glute Focus')).toBeVisible();
  });
});
