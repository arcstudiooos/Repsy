import { createHmac } from 'node:crypto';

/**
 * Product events (S5-4, §13) and the only properties each may carry. Values are ids hashed with
 * `ANALYTICS_HASH_SECRET`, enum keys, counts and booleans: never names, emails, free text, wellbeing answers or
 * message bodies (D-007). `org_id_hash` is allowed on every event.
 */
export const EVENT_PROPERTIES = {
  coach_signed_up: [],
  client_invited: [],
  program_created: [],
  program_assigned: ['client_id_hash', 'weekday_count'],
  workout_started: ['client_id_hash', 'logged_by_coach'],
  workout_completed: ['client_id_hash', 'logged_by_coach', 'set_count'],
  checkin_submitted: ['client_id_hash', 'answered_count'],
  review_flag_opened: ['rule_key'],
  review_flag_resolved: ['rule_key', 'action'],
  coach_message_sent: [],
  export_requested: ['scope'],
  error_visible: ['code', 'route'],
} as const satisfies Record<string, readonly string[]>;

export type EventName = keyof typeof EVENT_PROPERTIES;
export type EventValue = string | number | boolean;

export interface AnalyticsEvent {
  name: EventName;
  /** The acting user's id, hashed (`hashId`). */
  distinctId: string;
  properties: Record<string, EventValue>;
}

/** Implemented by the PostHog adapter (web, worker) and a no-op without `POSTHOG_KEY`. */
export interface AnalyticsPort {
  capture(event: AnalyticsEvent): void;
}

export const noopAnalytics: AnalyticsPort = { capture: () => {} };

/** Strings an event may carry: hashes, enum keys and route patterns (no spaces, so no free text). */
const SAFE_STRING = /^[A-Za-z0-9_:/.[\]-]{1,128}$/;

export class AnalyticsPropertyError extends Error {}

/**
 * Throws for an unknown event, a property outside the event's allowlist, or a value that could carry free text.
 * Adapters call it before sending, so a violation fails loudly in tests.
 */
export function assertAllowedEvent(event: AnalyticsEvent): void {
  const allowed = EVENT_PROPERTIES[event.name] as readonly string[] | undefined;
  if (!allowed) throw new AnalyticsPropertyError(`Unknown event: ${String(event.name)}`);
  if (!SAFE_STRING.test(event.distinctId)) {
    throw new AnalyticsPropertyError('distinctId must be a hashed id');
  }
  for (const [key, value] of Object.entries(event.properties)) {
    if (key !== 'org_id_hash' && !allowed.includes(key)) {
      throw new AnalyticsPropertyError(`Property "${key}" is not allowed on ${event.name}`);
    }
    if (typeof value === 'string' && !SAFE_STRING.test(value)) {
      throw new AnalyticsPropertyError(`Property "${key}" looks like free text`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new AnalyticsPropertyError(`Property "${key}" is not a finite number`);
    }
  }
}

/** HMAC-SHA256 of an id with the analytics secret (hex): stable per id, not reversible without the secret. */
export function hashId(secret: string, id: string): string {
  return createHmac('sha256', secret).update(id).digest('hex');
}
