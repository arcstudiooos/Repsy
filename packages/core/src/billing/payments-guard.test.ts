import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPaymentsProvider, onlinePaymentsAvailable } from './payments';

/** Go-live review 2026-11-08: the fake provider must never run in production unless asked for. */
describe('online payments guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is on outside production and off in production unless PAYMENTS_FAKE=true', () => {
    expect(onlinePaymentsAvailable({ NODE_ENV: 'test' })).toBe(true);
    expect(onlinePaymentsAvailable({ NODE_ENV: 'production' })).toBe(false);
    expect(onlinePaymentsAvailable({ NODE_ENV: 'production', PAYMENTS_FAKE: 'true' })).toBe(true);
  });

  it('refuses to hand out the fake provider in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PAYMENTS_FAKE', '');
    expect(() => defaultPaymentsProvider('stripe')).toThrow(
      expect.objectContaining({ code: 'PAYMENTS_UNAVAILABLE' }),
    );
    vi.stubEnv('PAYMENTS_FAKE', 'true');
    expect(defaultPaymentsProvider('stripe').kind).toBe('stripe');
  });
});
