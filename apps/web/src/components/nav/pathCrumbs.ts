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
