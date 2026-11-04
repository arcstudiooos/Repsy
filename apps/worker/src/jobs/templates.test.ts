import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasTemplate, renderTemplate } from './templates';

/** Every `templateKey: '…'` literal in core (outside tests). */
function coreTemplateKeys(): string[] {
  const root = join(__dirname, '..', '..', '..', '..', 'packages', 'core', 'src');
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        for (const m of readFileSync(path, 'utf8').matchAll(/templateKey: '([a-z_.]+)'/g)) {
          keys.add(m[1]!);
        }
      }
    }
  };
  walk(root);
  return [...keys].sort();
}

describe('templates', () => {
  it('cover every template key core enqueues, so no email goes out blank', () => {
    // auth.* emails carry their own subject/text/html in the payload.
    const missing = coreTemplateKeys().filter((k) => !k.startsWith('auth.') && !hasTemplate(k));
    expect(missing).toEqual([]);
  });

  it('render the billing and scheduling emails with a date and a link (K7, K10, J6)', () => {
    const failed = renderTemplate(
      'billing_payment_failed',
      { reason: 'Card declined', nextRetryAt: '2026-11-05T10:00:00.000Z' },
      'https://app.example/',
    );
    expect(failed.subject).toBe('Your payment did not go through');
    expect(failed.text).toContain('Card declined');
    expect(failed.text).toContain('5 Nov 2026');
    const last = renderTemplate(
      'billing_payment_failed',
      { nextRetryAt: null },
      'https://a.example',
    );
    expect(last.text).toContain('will not try again');
    const booking = renderTemplate(
      'booking_reminder',
      { sessionTypeName: 'PT <session>' },
      'https://a.example',
    );
    expect(booking.subject).toBe('Reminder: PT <session>');
    expect(booking.html).toContain('PT &#60;session&#62;');
    const renewal = renderTemplate(
      'package_renewal_reminder',
      { packageName: 'Gold', endsAt: '2026-12-01T00:00:00.000Z' },
      'https://a.example',
    );
    expect(renewal.text).toContain('Gold renews or ends on 1 Dec 2026.');
  });
});

describe('coach digest email (PRD H14)', () => {
  it('lists only non-zero counts, with a link, and escapes the workspace name', () => {
    const r = renderTemplate(
      'coach_digest',
      { orgName: 'Fit <Co>', checkins: 2, unread: 0, flags: 1 },
      'https://app.example/',
    );
    expect(r.subject).toBe('Your Repsy daily digest');
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
