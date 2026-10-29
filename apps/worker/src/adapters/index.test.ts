import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DevSinkEmailAdapter } from './devSinkEmail';
import { createEmailPort } from './index';
import { ResendEmailAdapter } from './resendEmail';

describe('createEmailPort', () => {
  it('uses the dev sink outside production when no provider key is set', () => {
    expect(createEmailPort({ NODE_ENV: 'development', DEV_EMAIL_DIR: '.x' })).toBeInstanceOf(
      DevSinkEmailAdapter,
    );
    expect(createEmailPort({ RESEND_API_KEY: '', DEV_EMAIL_DIR: '.x' })).toBeInstanceOf(
      DevSinkEmailAdapter,
    );
  });

  it('treats a blank DEV_EMAIL_DIR as unset (repo-root .dev-emails)', () => {
    const port = createEmailPort({ DEV_EMAIL_DIR: '' }) as DevSinkEmailAdapter;
    expect(port.dir).toBe(
      join(fileURLToPath(new URL('../../../../', import.meta.url)), '.dev-emails'),
    );
    expect((createEmailPort({ DEV_EMAIL_DIR: '/tmp/x' }) as DevSinkEmailAdapter).dir).toBe(
      '/tmp/x',
    );
  });

  it('uses Resend when configured', () => {
    expect(
      createEmailPort({ NODE_ENV: 'production', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.test' }),
    ).toBeInstanceOf(ResendEmailAdapter);
  });

  it.each([
    ['no RESEND_API_KEY', { EMAIL_FROM: 'a@b.test' }, /RESEND_API_KEY/],
    ['blank RESEND_API_KEY', { RESEND_API_KEY: '', EMAIL_FROM: 'a@b.test' }, /RESEND_API_KEY/],
    ['no EMAIL_FROM', { RESEND_API_KEY: 're_x' }, /EMAIL_FROM/],
    ['nothing at all', {}, /RESEND_API_KEY/],
  ])('throws in production with %s (no dev-sink fallback)', (_name, patch, message) => {
    expect(() => createEmailPort({ NODE_ENV: 'production', ...patch })).toThrow(message);
  });

  it('still requires EMAIL_FROM with a key outside production', () => {
    expect(() => createEmailPort({ RESEND_API_KEY: 're_x' })).toThrow(/EMAIL_FROM/);
  });
});
