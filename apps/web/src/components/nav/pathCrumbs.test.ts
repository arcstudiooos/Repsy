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
  it('names program builder routes instead of showing the opaque id (S3-1)', () => {
    const id = 'b13f5b66-4b02-4656-b796-1296fbc395e0';
    const program = { label: 'Program', href: `/app/programs/${id}/edit` };
    expect(crumbsFromPath(`/app/programs/${id}/edit`)).toEqual([
      { label: 'Overview', href: '/app' },
      { label: 'Programs', href: '/app/programs' },
      { label: 'Edit program' },
    ]);
    expect(crumbsFromPath(`/app/programs/${id}/history`)).toEqual([
      { label: 'Overview', href: '/app' },
      { label: 'Programs', href: '/app/programs' },
      program,
      { label: 'Version history' },
    ]);
    expect(crumbsFromPath(`/app/programs/${id}/versions/2`)).toEqual([
      { label: 'Overview', href: '/app' },
      { label: 'Programs', href: '/app/programs' },
      program,
      { label: 'Version history', href: `/app/programs/${id}/history` },
      { label: 'Version 2' },
    ]);
  });
  it('names the print page and opaque ids in other sections (QA 2026-11-06)', () => {
    const id = 'b13f5b66-4b02-4656-b796-1296fbc395e0';
    expect(crumbsFromPath(`/app/programs/${id}/print`)?.slice(2)).toEqual([
      { label: 'Program', href: `/app/programs/${id}/edit` },
      { label: 'Print' },
    ]);
    expect(crumbsFromPath(`/app/groups/${id}`)?.at(-1)).toEqual({ label: 'Group' });
    expect(crumbsFromPath(`/app/courses/${id}`)?.at(-1)).toEqual({ label: 'Course' });
    expect(crumbsFromPath(`/app/meal-plans/recipes/${id}`)?.at(-1)).toEqual({ label: 'Recipe' });
  });
});
