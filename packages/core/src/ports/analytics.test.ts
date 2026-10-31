import { describe, expect, it } from 'vitest';
import { AnalyticsPropertyError, assertAllowedEvent, hashId } from './analytics';

const H = hashId('secret', 'user-1');

describe('analytics allowlist (S5-4)', () => {
  it('accepts allowlisted properties and org_id_hash', () => {
    expect(() =>
      assertAllowedEvent({
        name: 'workout_completed',
        distinctId: H,
        properties: { client_id_hash: H, logged_by_coach: false, set_count: 4, org_id_hash: H },
      }),
    ).not.toThrow();
  });

  it('a property outside the allowlist throws', () => {
    expect(() =>
      assertAllowedEvent({ name: 'client_invited', distinctId: H, properties: { email: 'a@b.c' } }),
    ).toThrow(AnalyticsPropertyError);
  });

  it('free text in an allowed property throws; unknown events throw', () => {
    expect(() =>
      assertAllowedEvent({
        name: 'review_flag_resolved',
        distinctId: H,
        properties: { rule_key: 'Called her about her knee', action: 'resolve' },
      }),
    ).toThrow(/free text/);
    expect(() =>
      assertAllowedEvent({ name: 'nope' as never, distinctId: H, properties: {} }),
    ).toThrow(/Unknown event/);
    expect(() =>
      assertAllowedEvent({ name: 'coach_signed_up', distinctId: 'Jane Doe', properties: {} }),
    ).toThrow(/hashed/);
  });

  it('hashId is a stable HMAC-SHA256 hex digest', () => {
    expect(hashId('secret', 'user-1')).toBe(H);
    expect(H).toMatch(/^[0-9a-f]{64}$/);
    expect(hashId('other', 'user-1')).not.toBe(H);
  });
});
