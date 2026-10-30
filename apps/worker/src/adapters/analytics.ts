import { assertAllowedEvent, hashId, noopAnalytics, type AnalyticsPort } from '@kinetic/core';

type Env = Record<string, string | undefined>;

/**
 * The worker's PostHog adapter (S5-4): the HTTP capture API, fire-and-forget, allowlist-checked. Same contract as
 * the web adapter (apps/web/src/server/analytics.ts). No-op without POSTHOG_KEY.
 */
export function createAnalytics(env: Env = process.env): AnalyticsPort {
  const key = env.POSTHOG_KEY?.trim();
  if (!key) return noopAnalytics;
  const host = (env.POSTHOG_HOST?.trim() || 'https://eu.i.posthog.com').replace(/\/+$/, '');
  return {
    capture(event) {
      assertAllowedEvent(event);
      void fetch(`${host}/i/v0/e/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          event: event.name,
          distinct_id: event.distinctId,
          properties: { ...event.properties, $process_person_profile: false },
        }),
      }).catch(() => undefined);
    },
  };
}

/** System events are attributed to the organization (no acting user). */
export function systemDistinctId(env: Env, orgId: string): string {
  const secret = env.ANALYTICS_HASH_SECRET?.trim() || 'dev-only-analytics-hash-secret';
  return hashId(secret, `system:${orgId}`);
}

export const orgHash = (env: Env, orgId: string): string =>
  hashId(env.ANALYTICS_HASH_SECRET?.trim() || 'dev-only-analytics-hash-secret', orgId);
