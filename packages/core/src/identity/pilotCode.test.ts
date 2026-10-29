import { describe, expect, it } from 'vitest';
import { generatePilotCode, hashPilotCode, normalizePilotCode } from './pilotCode';

describe('generatePilotCode', () => {
  it('has at least 128 bits of entropy in Crockford base32, grouped', () => {
    const { code, codeHash } = generatePilotCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-)+[0-9A-HJKMNP-TV-Z]{4}$/);
    const chars = code.replaceAll('-', '').length;
    expect(chars * 5).toBeGreaterThanOrEqual(128);
    expect(codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unique per call', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePilotCode().code));
    expect(codes.size).toBe(50);
  });

  it('hash round-trips through normalization', () => {
    const { code, codeHash } = generatePilotCode();
    expect(hashPilotCode(code)).toBe(codeHash);
    expect(hashPilotCode(code.toLowerCase())).toBe(codeHash);
    expect(hashPilotCode(code.replaceAll('-', ''))).toBe(codeHash);
    expect(hashPilotCode(`  ${code.replaceAll('-', ' ').toLowerCase()} `)).toBe(codeHash);
  });
});

describe('normalizePilotCode', () => {
  it('uppercases and strips hyphens and whitespace', () => {
    expect(normalizePilotCode(' ab-cd ef\t')).toBe('ABCDEF');
  });
});
