import { describe, expect, it } from 'vitest';
import { createAuthHandlers } from '@/lib/auth-handler';
import { canSwitchWorkspace, shellRedirect } from '@/server/shellGate';

describe('shellRedirect (I4: shells route by the active org role)', () => {
  it('coach shell: coach roles stay, a client role goes to the portal', () => {
    expect(shellRedirect('coach', { role: 'owner' })).toBeNull();
    expect(shellRedirect('coach', { role: 'coach' })).toBeNull();
    expect(shellRedirect('coach', { role: 'client' })).toBe('/portal');
  });

  it('portal shell: a client stays, coach roles go to /app', () => {
    expect(shellRedirect('portal', { role: 'client' })).toBeNull();
    expect(shellRedirect('portal', { role: 'owner' })).toBe('/app');
    expect(shellRedirect('portal', { role: 'coach' })).toBe('/app');
  });

  it('an ambiguous or stale active org goes to the workspace chooser in both shells', () => {
    for (const shell of ['coach', 'portal'] as const) {
      expect(shellRedirect(shell, { error: 'ORG_SELECTION_REQUIRED' })).toBe('/select-org');
      expect(shellRedirect(shell, { error: 'NOT_FOUND' })).toBe('/select-org');
    }
  });

  it('no workspace at all goes to the role landing', () => {
    expect(shellRedirect('coach', { error: 'FORBIDDEN' })).toBe('/');
    expect(shellRedirect('portal', { error: 'FORBIDDEN' })).toBe('/');
  });
});

describe('canSwitchWorkspace', () => {
  it('needs two or more distinct organizations', () => {
    expect(canSwitchWorkspace([])).toBe(false);
    expect(canSwitchWorkspace([{ orgId: 'a', role: 'owner' }])).toBe(false);
    expect(
      canSwitchWorkspace([
        { orgId: 'a', role: 'owner' },
        { orgId: 'a', role: 'coach' },
      ]),
    ).toBe(false);
    expect(
      canSwitchWorkspace([
        { orgId: 'a', role: 'owner' },
        { orgId: 'b', role: 'client' },
      ]),
    ).toBe(true);
  });
});

describe('sign-out clears the active org cookie', () => {
  const fake = (status = 200) => ({
    handler: async () =>
      new Response('{}', {
        status,
        headers: { 'set-cookie': 'better-auth.session_token=; Max-Age=0; Path=/' },
      }),
  });
  const setCookies = (res: Response) => res.headers.getSetCookie();

  it('appends an expired repsy_org cookie to the sign-out response, keeping Better Auth cookies', async () => {
    const res = await createAuthHandlers(fake()).POST(
      new Request('http://localhost:3000/api/auth/sign-out', { method: 'POST' }),
    );
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith('better-auth.session_token='))).toBe(true);
    const org = cookies.find((c) => c.startsWith('repsy_org='));
    expect(org).toMatch(/^repsy_org=;/);
    expect(org).toMatch(/Max-Age=0/);
    expect(org).toMatch(/Path=\//);
    expect(org).toMatch(/HttpOnly/);
  });

  it('leaves other auth endpoints alone', async () => {
    const res = await createAuthHandlers(fake()).POST(
      new Request('http://localhost:3000/api/auth/sign-in/email', { method: 'POST' }),
    );
    expect(setCookies(res).some((c) => c.startsWith('repsy_org='))).toBe(false);
  });
});
