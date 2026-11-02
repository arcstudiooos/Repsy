import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('lessons and courses (PRD G4)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach writes a weekly course and enrols a client, who marks the first lesson done', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Cora Course');
    try {
      await page.goto('/app/courses');
      await page.getByRole('link', { name: 'New course' }).click();
      await page.getByLabel('Course title').fill('Habits 101');
      await page.getByLabel('Lesson 1 title').fill('Protein basics');
      await page.getByLabel('Lesson 1 text').fill('A palm of protein at each meal.');
      await page.getByRole('button', { name: 'Add a lesson' }).click();
      await page.getByLabel('Lesson 2 title').fill('Sleep');
      await page
        .getByLabel('Lesson 2 video or PDF link (optional)')
        .fill('https://example.test/sleep');
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Save course' }).click();
      await expect(page).toHaveURL(/\/app\/courses\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await expect(page.getByRole('heading', { name: 'Habits 101' })).toBeVisible();

      await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Cora Course' });
      const enrolled = page.waitForResponse(
        (r) => r.url().includes('/enrollments') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Enrol', exact: true }).click();
      expect((await enrolled).status()).toBe(201);
      const list = page.getByRole('list', { name: 'Enrolled clients' });
      await expect(list.getByText('0 of 2 done')).toBeVisible({ timeout: 15_000 });

      const p = client.page;
      await p.goto('/portal');
      await expect(p.getByText('Protein basics')).toBeVisible({ timeout: 30_000 });
      await p.getByRole('link', { name: 'Read lesson' }).click();
      await expect(p).toHaveURL(/\/portal\/learn$/);
      await expect(p.getByText('A palm of protein at each meal.')).toBeVisible();
      // Lesson 2 is locked: title and opening date only.
      await expect(p.getByText(/Lesson 2 · opens/)).toBeVisible();
      await expect(p.getByRole('link', { name: /Open the video or PDF/ })).toHaveCount(0);
      for (const width of [375, 1440]) {
        await p.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(p);
        await expectNoAxeViolations(p);
      }
      const marked = p.waitForResponse(
        (r) => r.url().includes('/lessons/') && r.request().method() === 'PUT',
      );
      await p.getByRole('button', { name: 'Mark as done: Protein basics' }).click();
      expect((await marked).status()).toBe(200);
      await expect(p.getByText('1 of 2 done')).toBeVisible({ timeout: 15_000 });

      await page.reload();
      await expect(list.getByText('1 of 2 done')).toBeVisible({ timeout: 15_000 });
      await openClientTab(page, 'Cora Course', 'History');
      await expect(
        page.getByRole('list', { name: 'Courses' }).getByText(/1 of 2 lessons done/),
      ).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await client.context.close();
    }
  });
});
