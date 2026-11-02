import { describe, expect, it } from 'vitest';
import { renderTemplate } from './templates';

describe('coach digest email (PRD H14)', () => {
  it('lists only non-zero counts, with a link, and escapes the workspace name', () => {
    const r = renderTemplate(
      'coach_digest',
      { orgName: 'Fit <Co>', checkins: 2, unread: 0, flags: 1 },
      'https://app.example/',
    );
    expect(r.subject).toBe('Your Kinetic daily digest');
    expect(r.text).toContain('- 2 check-ins waiting for your review');
    expect(r.text).toContain('- 1 item that needs review');
    expect(r.text).not.toContain('unread');
    expect(r.text).toContain('https://app.example/app');
    expect(r.html).toContain('Fit &#60;Co&#62;');
  });
});

describe('reminder emails (PRD H13, F9)', () => {
  it('carry a count and a link, no content, and how to turn them off', () => {
    const w = renderTemplate('workout_reminder', { workouts: 1 }, 'https://app.example/');
    expect(w.subject).toBe('You have a workout today');
    expect(w.text).toContain('https://app.example/portal');
    expect(w.text).toContain('turn reminders off');
    expect(renderTemplate('habit_reminder', { habits: 2 }, 'https://app.example').text).toContain(
      'You still have 2 habits to tick today.',
    );
    expect(renderTemplate('checkin_reminder', {}, 'https://app.example').text).toContain(
      'https://app.example/portal/check-ins',
    );
  });
});

describe('billing templates (PRD K6, K7)', () => {
  it('link to the receipt and the billing page, without amounts', () => {
    const receipt = renderTemplate('payment_receipt', { paymentId: 'p1' }, 'https://app.test/');
    expect(receipt?.text).toContain('https://app.test/portal/billing/receipts/p1');
    const failed = renderTemplate('payment_failed', {}, 'https://app.test');
    expect(failed?.text).toContain('https://app.test/portal/billing');
  });
});
