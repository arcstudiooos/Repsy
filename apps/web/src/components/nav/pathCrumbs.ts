import type { Crumb } from './Breadcrumbs';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

/** Malformed escapes (a lone `%`) must not crash the page: fall back to the raw segment. */
const safeDecode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** Program builder routes (/app/programs/:id/edit|history|versions/:no): the id is opaque, so name the pages. */
function programCrumbs(segments: string[]): Crumb[] | null {
  const [root, id, page, no] = segments;
  if (root !== 'programs' || !id || !page) return null;
  const base = `/app/programs/${id}`;
  const programs: Crumb = { label: 'Programs', href: '/app/programs' };
  const program: Crumb = { label: 'Program', href: `${base}/edit` };
  if (page === 'edit' && segments.length === 3) return [programs, { label: 'Edit program' }];
  if (page === 'history' && segments.length === 3) {
    return [programs, program, { label: 'Version history' }];
  }
  if (page === 'versions' && no && segments.length === 4) {
    return [
      programs,
      program,
      { label: 'Version history', href: `${base}/history` },
      { label: `Version ${safeDecode(no)}` },
    ];
  }
  return null;
}

/**
 * Crumbs for nested coach routes (/app/clients/123 gives Overview / Clients / 123);
 * `null` on top-level pages.
 */
export function crumbsFromPath(pathname: string): Crumb[] | null {
  const segments = pathname.split('/').filter(Boolean).slice(1); // drop "app"
  if (segments.length < 2) return null;
  // Client pages render their own crumbs (Clients / name): the URL only holds an opaque id.
  if (segments[0] === 'clients') return null;
  const crumbs: Crumb[] = [{ label: 'Overview', href: '/app' }];
  const program = programCrumbs(segments);
  if (program) return [...crumbs, ...program];
  segments.forEach((segment, i) => {
    const href = `/app/${segments.slice(0, i + 1).join('/')}`;
    crumbs.push(
      i === segments.length - 1
        ? { label: capitalize(safeDecode(segment)) }
        : { label: capitalize(safeDecode(segment)), href },
    );
  });
  return crumbs;
}
