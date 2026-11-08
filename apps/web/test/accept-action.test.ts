import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionUser = vi.fn();
const acceptWithSignup = vi.fn();

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/auth', () => ({ auth: {}, getSessionUser }));
vi.mock('@/lib/accept-invite', () => ({ acceptWithSignup }));
vi.mock('@repsy/db', () => ({ prisma: {} }));

const form = () => {
  const data = new FormData();
  data.set('token', 't');
  data.set('password', 'pw');
  return data;
};

describe('acceptWithSignupAction', () => {
  beforeEach(() => {
    getSessionUser.mockReset();
    acceptWithSignup.mockReset();
  });

  it('rejects with a form error when a session exists, without accepting', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1' });
    const { acceptWithSignupAction } = await import('@/app/invite/[token]/actions');
    const state = await acceptWithSignupAction({}, form());
    expect(state.fieldErrors?.form).toBe(
      "You're signed in. Sign out to accept this invite with a new account.",
    );
    expect(acceptWithSignup).not.toHaveBeenCalled();
  });

  it('proceeds when signed out', async () => {
    getSessionUser.mockResolvedValue(null);
    acceptWithSignup.mockResolvedValue({ ok: false, fieldErrors: { password: 'x' } });
    const { acceptWithSignupAction } = await import('@/app/invite/[token]/actions');
    const state = await acceptWithSignupAction({}, form());
    expect(state.fieldErrors).toEqual({ password: 'x' });
    expect(acceptWithSignup).toHaveBeenCalledOnce();
  });
});
