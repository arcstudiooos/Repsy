'use client';

import { usePathname } from 'next/navigation';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

/**
 * Default breadcrumbs from the URL for nested coach routes (/app/clients/123 gives
 * Overview / Clients / 123). Renders nothing on top-level pages. Pages with
 * readable titles can render <Breadcrumbs> themselves instead.
 */
export function PathBreadcrumbs() {
  const segments = usePathname().split('/').filter(Boolean).slice(1); // drop "app"
  if (segments.length < 2) return null;
  const crumbs: Crumb[] = [{ label: 'Overview', href: '/app' }];
  segments.forEach((segment, i) => {
    const href = `/app/${segments.slice(0, i + 1).join('/')}`;
    crumbs.push(
      i === segments.length - 1
        ? { label: capitalize(decodeURIComponent(segment)) }
        : { label: capitalize(segment), href },
    );
  });
  return <Breadcrumbs items={crumbs} />;
}
