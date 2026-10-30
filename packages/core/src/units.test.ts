import { describe, expect, it } from 'vitest';
import { fromDisplay, toDisplay } from './units';

describe('units', () => {
  it('kg passes through to one decimal', () => {
    expect(toDisplay(60, 'kg')).toBe(60);
    expect(toDisplay(61.235, 'kg')).toBe(61.2);
  });

  it('135 lb round trips with 61.235 kg', () => {
    expect(fromDisplay(135, 'lb')).toBe(61.235);
    expect(toDisplay(61.235, 'lb')).toBe(135);
    expect(toDisplay(61.2, 'kg')).toBe(61.2);
  });

  it('fromDisplay keeps kg at 3 decimals', () => {
    expect(fromDisplay(61.2349, 'kg')).toBe(61.235);
    expect(fromDisplay(0, 'lb')).toBe(0);
  });
});
