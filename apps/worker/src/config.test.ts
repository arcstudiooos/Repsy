import { describe, expect, it } from 'vitest';
import { outboxPollIntervalMs } from './config';

describe('outboxPollIntervalMs', () => {
  it('defaults to 30000', () => {
    expect(outboxPollIntervalMs({})).toBe(30_000);
    expect(outboxPollIntervalMs({ OUTBOX_POLL_INTERVAL_MS: '' })).toBe(30_000);
  });
  it('uses OUTBOX_POLL_INTERVAL_MS when set', () => {
    expect(outboxPollIntervalMs({ OUTBOX_POLL_INTERVAL_MS: '5000' })).toBe(5000);
  });
  it('rejects invalid values', () => {
    expect(() => outboxPollIntervalMs({ OUTBOX_POLL_INTERVAL_MS: 'abc' })).toThrow();
    expect(() => outboxPollIntervalMs({ OUTBOX_POLL_INTERVAL_MS: '0' })).toThrow();
  });
});
