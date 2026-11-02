import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('groups: chat and feed (PRD H7, H8)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('members post, comment, react, chat and report; the coach moderates', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const ana = await onboardClient(page, request, browser, 'Ana Group');
    const ben = await onboardClient(page, request, browser, 'Ben Group');
    try {
      await page.goto('/app/groups');
      await page.getByLabel('Group name').fill('Spring cohort');
      await page.getByRole('button', { name: 'Create group' }).click();
      await expect(page).toHaveURL(/\/app\/groups\/[0-9a-f-]{36}\?tab=members$/, {
        timeout: 30_000,
      });
      const groupUrl = page.url().replace(/\?tab=members$/, '');
      const groupPath = new URL(groupUrl).pathname.replace('/app/', '/portal/');
      await page.getByLabel('Ana Group').check();
      await page.getByLabel('Ben Group').check();
      await page.getByRole('button', { name: 'Save members' }).click();
      await expect(page.getByText('2 members')).toBeVisible({ timeout: 15_000 });

      const a = ana.page;
      await a.goto('/portal');
      await a.getByRole('link', { name: 'Your groups' }).click();
      await a.getByRole('link', { name: 'Spring cohort' }).click();
      await a.getByLabel('Share with the group').fill('Hit a 100 kg squat today!');
      const posted = a.waitForResponse(
        (r) => r.url().endsWith('/posts') && r.request().method() === 'POST',
      );
      await a.getByRole('button', { name: 'Post', exact: true }).click();
      expect((await posted).status()).toBe(201);
      // Scoped: the composer's textarea also holds the text until the post is saved.
      await expect(
        a.getByRole('list', { name: 'Posts' }).getByText('Hit a 100 kg squat today!'),
      ).toBeVisible({ timeout: 15_000 });
      for (const width of [375, 1440]) {
        await a.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(a);
        await expectNoAxeViolations(a);
      }

      const b = ben.page;
      await b.goto(groupPath);
      await expect(
        b.getByRole('list', { name: 'Posts' }).getByText('Hit a 100 kg squat today!'),
      ).toBeVisible({ timeout: 30_000 });
      await b.getByRole('button', { name: /Strong/ }).click();
      await expect(b.getByRole('button', { name: '💪 Strong 1' })).toHaveAttribute(
        'aria-pressed',
        'true',
        {
          timeout: 15_000,
        },
      );
      await b.getByLabel("Comment on Ana G.'s post").fill('Huge, well done!');
      await b.getByRole('button', { name: 'Comment', exact: true }).click();
      await expect(
        b.getByRole('list', { name: "Comments on Ana G.'s post" }).getByText('Huge, well done!'),
      ).toBeVisible({ timeout: 15_000 });
      b.once('dialog', (d) => void d.accept('Testing reports'));
      const reported = b.waitForResponse(
        (r) => r.url().includes('/group-reports') && r.request().method() === 'POST',
      );
      await b.getByRole('button', { name: /^Report: post by Ana G\./ }).click();
      expect((await reported).status()).toBe(201);

      await b.getByRole('link', { name: 'Chat' }).click();
      await expect(b).toHaveURL(/tab=chat$/);
      await b.getByLabel('Message the group').fill('Anyone training Sunday?');
      await b.getByRole('button', { name: 'Send' }).click();
      await expect(
        b.getByRole('list', { name: 'Chat' }).getByText('Anyone training Sunday?'),
      ).toBeVisible({
        timeout: 15_000,
      });
      await expectNoAxeViolations(b);

      await page.goto('/app/groups');
      await expect(page.getByText('1 reported')).toBeVisible({ timeout: 15_000 });
      await page.goto(groupUrl);
      await expect(page.getByRole('heading', { name: 'Reported (1)' })).toBeVisible();
      await expect(page.getByText('“Testing reports”')).toBeVisible();
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Hide it' }).click();
      await expect(page.getByRole('heading', { name: /Reported/ })).toBeHidden({ timeout: 15_000 });
      await expect(page.getByText('Hidden', { exact: true })).toBeVisible();

      await a.reload();
      await expect(a.getByText('No posts yet. Start the conversation.')).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await ana.context.close();
      await ben.context.close();
    }
  });
});
