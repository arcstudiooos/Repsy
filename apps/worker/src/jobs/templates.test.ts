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
