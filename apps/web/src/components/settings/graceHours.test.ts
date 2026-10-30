import { describe, expect, it } from 'vitest';
import { graceHoursValue } from './graceHours';

describe('graceHoursValue', () => {
  it('blank or missing is null (the server rejects it), never 0', () => {
    expect(graceHoursValue('')).toBeNull();
    expect(graceHoursValue('   ')).toBeNull();
    expect(graceHoursValue(null)).toBeNull();
  });
  it('numbers pass through for the server to range-check', () => {
    expect(graceHoursValue('0')).toBe(0);
    expect(graceHoursValue('36')).toBe(36);
    expect(graceHoursValue('1.5')).toBe(1.5);
  });
  it('junk is null', () => {
    expect(graceHoursValue('abc')).toBeNull();
  });
});
