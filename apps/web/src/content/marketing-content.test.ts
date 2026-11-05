import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPETITORS, PLANS } from './marketing';

const MAX_AGE_DAYS = 120;
const DAY = 24 * 60 * 60 * 1000;

// Landing PRD §12: copy we never ship.
const BANNED = [
  'revolutionize',
  'unleash',
  'supercharge',
  'seamless',
  'game-changer',
  'all-in-one solution',
  'elevate',
  'empower',
  'cutting-edge',
  'next-level',
  'unlock your potential',
  "in today's fast-paced world",
];

const MARKETING_DIR = join(__dirname, '..', 'components', 'marketing');
const FILES = [
  join(__dirname, 'marketing.ts'),
  ...readdirSync(MARKETING_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(MARKETING_DIR, f)),
];

describe('landing comparison data', () => {
  it.each(COMPETITORS.map((c) => [c.name, c] as const))(
    '%s was checked in the last 120 days and cites a source',
    (_name, c) => {
      const age = (Date.now() - new Date(c.lastVerified).getTime()) / DAY;
      expect(Number.isNaN(age)).toBe(false);
      expect(age).toBeLessThanOrEqual(MAX_AGE_DAYS);
      expect(c.sources.length).toBeGreaterThan(0);
    },
  );
});

describe('landing pricing', () => {
  it('annual is never more than twelve months', () => {
    for (const p of PLANS) expect(p.annual).toBeLessThanOrEqual(p.monthly * 12);
  });
});

describe('landing copy', () => {
  it.each(FILES)('%s has no banned words', (file) => {
    const text = readFileSync(file, 'utf8').toLowerCase();
    expect(BANNED.filter((w) => text.includes(w))).toEqual([]);
  });
});
