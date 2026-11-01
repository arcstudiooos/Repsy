import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('client import from CSV (PRD B17)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coach previews a roster, imports the valid rows, and sees them in the list', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    const tag = Date.now().toString(36);
    await page.goto('/app/clients');
    await page.getByRole('link', { name: 'Import from CSV' }).first().click();
    await expect(page.getByRole('heading', { name: 'Import clients' })).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByLabel('Or paste it here')
      .fill(
        [
          'First Name,Last Name,Email,Goal,Weight Unit',
          `Imra,Ported,imra-${tag}@example.test,"Squat 100kg, then 120",lb`,
          `Bad,Email,not-an-email,,`,
          `Imra,Again,IMRA-${tag}@example.test,,`,
          `Iggy,Imported,iggy-${tag}@example.test,,`,
        ].join('\n'),
      );
    await page.getByRole('button', { name: 'Check file' }).click();
    await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('status')).toContainText(
      '2 ready to import. 2 rows will be skipped',
    );
    await expect(page.getByText('Skipped: Email is not valid.')).toBeVisible();
    await expect(page.getByText('Skipped: This email appears earlier in the file.')).toBeVisible();
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }

    await page.getByRole('button', { name: 'Import 2 clients' }).click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('status')).toContainText('Imported 2 clients.');
    await expect(page.getByRole('link', { name: 'Imported' })).toHaveCount(2);
    await expectNoAxeViolations(page);

    await page.getByRole('link', { name: 'Go to clients' }).click();
    await expect(page.getByRole('link', { name: 'Imra Ported' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Iggy Imported' })).toBeVisible();

    // Importing the same file again creates nothing.
    await page.goto('/app/clients/import');
    await page
      .getByLabel('Or paste it here')
      .fill(`Name,Email\nImra Ported,imra-${tag}@example.test`);
    await page.getByRole('button', { name: 'Check file' }).click();
    await expect(page.getByText('Skipped: A client with this email already exists.')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /^Import \d/ })).toHaveCount(0);
  });

  test('a file without an email column is rejected before anything is sent', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/clients/import');
    await page.getByLabel('Or paste it here').fill('Name,Phone\nAna,123');
    await page.getByRole('button', { name: 'Check file' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'No email column found' }),
    ).toBeVisible();
  });

  test('a coach matches columns by hand, and can ask for a concierge migration (PRD M4)', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    const tag = Date.now().toString(36);
    await page.goto('/app/clients/import');
    const template = await page.request.get(
      (await page.getByRole('link', { name: 'Download a CSV template' }).getAttribute('href'))!,
    );
    expect(await template.text()).toMatch(/^Name,Email,Goals,Time zone,Units/);
    await page
      .getByLabel('Or paste it here')
      .fill(`Client,Contact\nAna Map,ana-${tag}@example.test`);
    await page.getByRole('button', { name: 'Check file' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Choose it below' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).selectOption({ label: 'Contact' });
    await page.getByRole('button', { name: 'Check file' }).click();
    await expect(page.getByRole('status')).toContainText('1 ready to import.', {
      timeout: 15_000,
    });
    await expectNoAxeViolations(page);

    await page.goto('/app/clients/import');
    await page.getByRole('link', { name: /move your clients and programs/ }).click();
    await expect(page.getByLabel('Topic')).toHaveValue('migration', { timeout: 30_000 });
    await page.getByLabel('Message').fill('Moving 40 clients from another app.');
    await page.getByRole('button', { name: /Send/ }).click();
    await expect(page.getByText('Thanks, we have your message')).toBeVisible({ timeout: 15_000 });
  });
});
