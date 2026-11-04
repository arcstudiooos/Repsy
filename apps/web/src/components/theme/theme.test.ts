import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, themeBootScript } from './theme';

describe('theme boot script', () => {
  it('reads the same storage key and only accepts light or dark', () => {
    expect(themeBootScript).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(themeBootScript).toContain("v==='light'||v==='dark'");
  });
  it('is a self-invoking function with no external references', () => {
    expect(themeBootScript.startsWith('(function(){')).toBe(true);
    expect(themeBootScript).not.toMatch(/import|require\(/);
  });
});
