import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const thisMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
  new Date(),
);

test.describe('monthly progress report (PRD E10)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach writes a report; the client is told and downloads the PDF', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Rex Report');
    const portal = client.page;
    try {
      await openClientTab(page, 'Rex Report', 'Progress');
      await page.getByLabel('Month', { exact: true }).selectOption({ label: thisMonth });
      await page.getByLabel('Your summary for the month').fill('Strong start. Keep sleeping well.');
      await expectNoAxeViolations(page);
      const saved = page.waitForResponse(
        (r) => r.url().includes('/progress-reports') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Create report' }).click();
      expect((await saved).status()).toBe(201);
      const link = page.getByRole('link', { name: `${thisMonth} report (PDF)` });
      await expect(link).toBeVisible({ timeout: 15_000 });
      const coachPdf = await page.request.get((await link.getAttribute('href'))!);
      expect(coachPdf.status()).toBe(200);

      await portal.goto('/portal/messages');
      await expect(portal.getByText(/progress report for .* is ready/).first()).toBeVisible({
        timeout: 30_000,
      });
      await portal.goto('/portal/progress');
      const mine = portal.getByRole('link', { name: `${thisMonth} report (PDF)` });
      await expect(mine).toBeVisible({ timeout: 30_000 });
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }
      const pdf = await portal.request.get((await mine.getAttribute('href'))!);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()['content-type']).toBe('application/pdf');
      const body = (await pdf.body()).toString('latin1');
      expect(body.startsWith('%PDF-1.4')).toBe(true);
      // Text in the file is hex-encoded.
      expect(body).toContain(Buffer.from('Rex Report', 'latin1').toString('hex'));
    } finally {
      await client.context.close();
    }
  });
});
