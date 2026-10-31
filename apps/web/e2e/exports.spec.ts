import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers/journey';
import { onboardClient } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('exports (S5-2)', () => {
  // The worker builds exports every minute.
  test.describe.configure({ timeout: 240_000 });

  test('a client downloads their own data; the owner exports the organization', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Exa Export');
    try {
      const portal = client.page;
      await portal.goto('/portal/profile');
      await portal.getByRole('button', { name: 'Download my data' }).click();
      const mine = portal.getByRole('list', { name: 'Your exports' });
      await expect(mine.getByText('Preparing')).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(portal);
      await expect(mine.getByText('Ready')).toBeVisible({ timeout: 150_000 });
      const download = portal.waitForEvent('download');
      await mine.getByRole('button', { name: /^Download profile\.csv/ }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe('profile.csv');
      const path = await file.path();
      const { readFile } = await import('node:fs/promises');
      const csv = await readFile(path, 'utf8');
      expect(csv.split('\r\n')[0]).toBe('name,email,timezone,preferred_units,start_date,goals');
      expect(csv).toContain('Exa Export');

      await page.goto('/settings');
      await page.getByRole('button', { name: 'Export organization data' }).click();
      await expect(
        page.getByRole('list', { name: 'Your exports' }).getByText('Preparing'),
      ).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(page);
    } finally {
      await client.context.close();
    }
  });
});
