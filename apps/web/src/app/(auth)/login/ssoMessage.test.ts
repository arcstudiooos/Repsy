import { describe, expect, it } from 'vitest';
import { ssoMessage } from './ssoMessage';

describe('ssoMessage', () => {
  it('points a Google user with no account to sign-up', () => {
    const m = ssoMessage('google', 'signup_disabled');
    expect(m?.signUpLink).toBe(true);
    expect(m?.text).toMatch(/No Repsy account uses that Google email/);
  });

  it('shows a retry message for any other Google error', () => {
    expect(ssoMessage('google', 'invalid_code')?.text).toMatch(/did not finish/);
    expect(ssoMessage('google', undefined)?.signUpLink).toBe(false);
  });

  it('keeps the workspace message for a refused Microsoft sign-in', () => {
    expect(ssoMessage('refused', undefined)?.text).toMatch(/workspace owner/);
  });

  it('shows nothing without an sso parameter', () => {
    expect(ssoMessage(undefined, 'signup_disabled')).toBeNull();
  });
});
