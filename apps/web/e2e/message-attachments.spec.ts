import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, onboardClient, openClientTab } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('message attachments (PRD H2)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the client sends a PDF; the coach opens it', async ({ page, request, browser }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Ari Attach');
    const portal = client.page;
    try {
      await portal.goto('/portal/messages');
      await portal.getByLabel('Attach a photo or PDF').setInputFiles({
        name: 'bloodwork.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n% test\n'),
      });
      await expect(portal.getByText('Attached: bloodwork.pdf')).toBeVisible({ timeout: 30_000 });
      await expectNoAxeViolations(portal);
      await portal.getByRole('button', { name: 'Send' }).click();
      const link = portal.getByRole('link', { name: 'PDF attachment' });
      await expect(link).toBeVisible({ timeout: 15_000 });

      await openClientTab(page, 'Ari Attach', 'Messages');
      const coachLink = page.getByRole('link', { name: 'PDF attachment' });
      await expect(coachLink).toBeVisible({ timeout: 30_000 });
      const res = await page.request.get((await coachLink.getAttribute('href'))!);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('application/pdf');
      expect(res.headers()['content-disposition']).toBe('attachment');
      // A wrong type is refused before anything is stored.
      await portal.getByLabel('Attach a photo or PDF').setInputFiles({
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
      });
      await expect(portal.getByText('Send a photo (JPEG, PNG, WebP) or a PDF.')).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await client.context.close();
    }
  });
});
