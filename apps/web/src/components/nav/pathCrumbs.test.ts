import { describe, expect, it } from 'vitest';
import { crumbsFromPath } from './pathCrumbs';

describe('crumbsFromPath', () => {
  it('builds Overview / Programs / id', () => {
    expect(crumbsFromPath('/app/programs/123')).toEqual([
      { label: 'Overview', href: '/app' },
      { label: 'Programs', href: '/app/programs' },
      { label: '123' },
    ]);
  });
  it('leaves client pages to render their own crumbs', () => {
    expect(crumbsFromPath('/app/clients/123')).toBeNull();
    expect(crumbsFromPath('/app/clients/123/program')).toBeNull();
  });
  it('returns nothing for top-level pages', () => {
    expect(crumbsFromPath('/app')).toBeNull();
    expect(crumbsFromPath('/app/clients')).toBeNull();
  });
  it('decodes valid escapes in the last segment', () => {
    expect(crumbsFromPath('/app/programs/a%20b')?.at(-1)).toEqual({ label: 'A b' });
  });
  it('does not throw on malformed % segments', () => {
    const crumbs = crumbsFromPath('/app/programs/100%');
    expect(crumbs?.at(-1)).toEqual({ label: '100%' });
    expect(() => crumbsFromPath('/app/%E0%A4%A/x')).not.toThrow();
  });
});
