import { describe, expect, it } from 'vitest';
import { crumbsFromPath } from './pathCrumbs';

describe('crumbsFromPath', () => {
  it('builds Overview / Clients / id', () => {
    expect(crumbsFromPath('/app/clients/123')).toEqual([
      { label: 'Overview', href: '/app' },
      { label: 'Clients', href: '/app/clients' },
      { label: '123' },
    ]);
  });
  it('returns nothing for top-level pages', () => {
    expect(crumbsFromPath('/app')).toBeNull();
    expect(crumbsFromPath('/app/clients')).toBeNull();
  });
  it('decodes valid escapes in the last segment', () => {
    expect(crumbsFromPath('/app/clients/a%20b')?.at(-1)).toEqual({ label: 'A b' });
  });
  it('does not throw on malformed % segments', () => {
    const crumbs = crumbsFromPath('/app/clients/100%');
    expect(crumbs?.at(-1)).toEqual({ label: '100%' });
    expect(() => crumbsFromPath('/app/%E0%A4%A/x')).not.toThrow();
  });
});
