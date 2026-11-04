import { describe, expect, it } from 'vitest';
import {
  CLIENT_LAPSE_DAYS,
  COACH_LAPSE_DAYS,
  assertWritable,
  enforceReadOnly,
  lapseAccess,
} from './lapse';

/**
 * Pure-logic tests only: no database. The M12 windows are 90 days for
 * clients and 180 days for coaches, inclusive of the final day.
 */
const DAY = 86_400_000;
const LAPSED = new Date('2026-01-01T00:00:00Z');

describe('lapseAccess (M12)', () => {
  it('is full with no lapse, and before the lapse date', () => {
    expect(lapseAccess('client', null, LAPSED)).toBe('full');
    expect(lapseAccess('coach', null, LAPSED)).toBe('full');
    expect(lapseAccess('client', LAPSED, new Date('2025-12-31T00:00:00Z'))).toBe('full');
  });

  it('gives clients 90 days of read-only access, inclusive', () => {
    expect(CLIENT_LAPSE_DAYS).toBe(90);
    expect(lapseAccess('client', LAPSED, new Date(LAPSED.getTime() + 89 * DAY))).toBe('read_only');
    expect(lapseAccess('client', LAPSED, new Date(LAPSED.getTime() + 90 * DAY))).toBe('read_only');
    expect(lapseAccess('client', LAPSED, new Date(LAPSED.getTime() + 90 * DAY + 1))).toBe(
      'expired',
    );
  });

  it('gives coaches 180 days of read-only access, inclusive', () => {
    expect(COACH_LAPSE_DAYS).toBe(180);
    expect(lapseAccess('coach', LAPSED, new Date(LAPSED.getTime() + 180 * DAY))).toBe('read_only');
    expect(lapseAccess('coach', LAPSED, new Date(LAPSED.getTime() + 180 * DAY + 1))).toBe(
      'expired',
    );
    // A coach is still read-only long after a client's window has closed.
    expect(lapseAccess('coach', LAPSED, new Date(LAPSED.getTime() + 120 * DAY))).toBe('read_only');
    expect(lapseAccess('client', LAPSED, new Date(LAPSED.getTime() + 120 * DAY))).toBe('expired');
  });
});

describe('enforceReadOnly', () => {
  it('allows reads and exports but blocks writes in read-only mode', () => {
    expect(enforceReadOnly('read_only', 'read')).toBe(true);
    expect(enforceReadOnly('read_only', 'export')).toBe(true);
    expect(enforceReadOnly('read_only', 'write')).toBe(false);
  });

  it('allows everything when full and nothing when expired', () => {
    for (const action of ['read', 'write', 'export'] as const) {
      expect(enforceReadOnly('full', action)).toBe(true);
      expect(enforceReadOnly('expired', action)).toBe(false);
    }
  });

  it('assertWritable throws for read-only and expired access', () => {
    expect(() => assertWritable('read_only')).toThrow();
    expect(() => assertWritable('expired')).toThrow();
    expect(assertWritable('full')).toBe('full');
  });
});
