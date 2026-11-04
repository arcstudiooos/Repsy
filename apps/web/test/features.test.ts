import { describe, expect, it, vi } from 'vitest';
import { createApiHandler } from '@/server/api';
import { featureEnabled } from '@/server/features';
import { domainsListRoute } from '@/server/routes/domains';

describe('feature switches (D-015)', () => {
  it('are off unless the env var is exactly "true"', () => {
    expect(featureEnabled('customDomains', {})).toBe(false);
    expect(featureEnabled('customDomains', { FEATURE_CUSTOM_DOMAINS: '' })).toBe(false);
    expect(featureEnabled('customDomains', { FEATURE_CUSTOM_DOMAINS: '1' })).toBe(false);
    expect(featureEnabled('customDomains', { FEATURE_CUSTOM_DOMAINS: 'TRUE' })).toBe(false);
    expect(featureEnabled('customDomains', { FEATURE_CUSTOM_DOMAINS: 'true' })).toBe(true);
  });

  it('every custom-domain route is behind the switch', async () => {
    const routes = await import('@/server/routes/domains');
    for (const route of Object.values(routes)) {
      expect(route.feature).toBe('customDomains');
    }
  });

  it('answers 404 before sign-in or any database work while the switch is off', async () => {
    const getSession = vi.fn();
    const handler = createApiHandler({
      env: {},
      auth: { api: { getSession } } as never,
      prisma: {} as never,
    })(domainsListRoute);
    const res = await handler(new Request('http://localhost/api/v1/domains'), {
      params: Promise.resolve({}),
    } as never);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(getSession).not.toHaveBeenCalled();
  });
});
