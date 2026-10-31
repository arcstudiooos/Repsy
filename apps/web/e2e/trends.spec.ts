import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

/** A local date (YYYY-MM-DD) `days` from today in the runner's zone, which the client accepted with. */
const localDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 86_400_000),
  );

test.describe('progress trends (PRD E2)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('body weight trend with a 7-day average, range filter, keyboard values and a table', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Tia Trend');
    try {
      await openClientTab(page, 'Tia Trend', 'Progress');
      const clientId = new URL(page.url()).pathname.split('/')[3];
      const origin = new URL(page.url()).origin;
      for (const [days, value] of [
        [-40, 80],
        [-10, 79],
        [-2, 78.5],
      ] as const) {
        const res = await page.request.post(`/api/v1/clients/${clientId}/metrics`, {
          data: { metric: 'weight', measuredOn: localDate(days), value },
          headers: { origin },
        });
        expect(res.ok()).toBe(true);
      }
      await page.reload();
      const chart = page.getByRole('figure', { name: /^Body weight/ });
      await expect(chart).toBeVisible({ timeout: 30_000 });
      await expect(chart.getByRole('list', { name: 'Legend' })).toContainText('7-day average');
      const plot = chart.getByRole('img');
      await expect(plot).toHaveAttribute('aria-label', /last 12 weeks: 3 readings/);
      await chart.getByRole('button', { name: '4w' }).click();
      await expect(chart.getByRole('button', { name: '4w' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(plot).toHaveAttribute('aria-label', /last 4 weeks: 2 readings/);

      // Arrow keys read values; End jumps to the latest reading.
      await plot.focus();
      await page.keyboard.press('End');
      await expect(chart.getByRole('status')).toContainText('78.5 kg');
      await page.keyboard.press('ArrowLeft');
      await expect(chart.getByRole('status')).toContainText('79 kg');

      await chart.getByText('Show as a table').click();
      const table = chart.getByRole('table', { name: 'Body weight, last 4 weeks' });
      await expect(table.getByRole('row')).toHaveCount(3);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }

      // The client sees the same trend in the portal.
      await client.page.goto('/portal/progress');
      await expect(client.page.getByRole('figure', { name: /^Body weight/ })).toBeVisible({
        timeout: 30_000,
      });
      await expectNoAxeViolations(client.page);
    } finally {
      await client.context.close();
    }
  });
});
