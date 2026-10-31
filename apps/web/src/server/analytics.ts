import {
  assertAllowedEvent,
  hashId,
  logger,
  noopAnalytics,
  type ActorContext,
  type AnalyticsPort,
  type EventName,
  type EventValue,
} from '@kinetic/core';

type Env = Record<string, string | undefined>;

/**
 * PostHog over its HTTP capture API (S5-4): no SDK, fire-and-forget, so analytics never slows or fails a request.
 * Every event is checked against the §13 allowlist first. Without POSTHOG_KEY it is a no-op.
 */
export function createPostHogPort(env: Env = process.env): AnalyticsPort {
  const key = env.POSTHOG_KEY?.trim();
  if (!key) return noopAnalytics;
  // Misconfigured (PR #2 review C M-5): ids would be hashed with the public dev key, so nothing is sent at all.
  if (env.NODE_ENV === 'production' && !env.ANALYTICS_HASH_SECRET?.trim()) {
    logger.error(
      { event: 'analytics_disabled' },
      'POSTHOG_KEY is set without ANALYTICS_HASH_SECRET',
    );
    return noopAnalytics;
  }
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
          // No person profiles: the distinct id is a hash and nothing else is known about the user.
          properties: { ...event.properties, $process_person_profile: false },
        }),
      }).catch(() => undefined);
    },
  };
}

/**
 * The HMAC key for ids sent to analytics. Never throws, since it runs after a request's work committed (PR #2 review
 * C M-5): without it in production the PostHog port is a no-op, so the dev fallback hashes nothing that is sent.
 */
export function analyticsHashSecret(env: Env = process.env): string {
  return env.ANALYTICS_HASH_SECRET?.trim() || 'dev-only-analytics-hash-secret';
}

let shared: AnalyticsPort | undefined;
export const defaultAnalytics = (): AnalyticsPort => (shared ??= createPostHogPort());

/** Builds an actor's event: hashed user id as the distinct id, hashed org id on every event. */
export function eventFor(
  secret: string,
  actor: Pick<ActorContext, 'userId' | 'orgId'> | { userId: string; orgId?: string },
  name: EventName,
  properties: Record<string, EventValue> = {},
) {
  return {
    name,
    distinctId: hashId(secret, actor.userId),
    properties: {
      ...(actor.orgId ? { org_id_hash: hashId(secret, actor.orgId) } : {}),
      ...properties,
    },
  };
}

/** `client_id_hash` for an event about a client. */
export const clientHash = (secret: string, clientId: string) => hashId(secret, clientId);
