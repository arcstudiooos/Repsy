'use client';

import { usePathname } from 'next/navigation';
import { Breadcrumbs } from './Breadcrumbs';
import { crumbsFromPath } from './pathCrumbs';

/**
 * Default breadcrumbs from the URL for nested coach routes. Renders nothing on
 * top-level pages. Pages with readable titles can render <Breadcrumbs> themselves instead.
 */
export function PathBreadcrumbs() {
  const crumbs = crumbsFromPath(usePathname());
  return crumbs ? <Breadcrumbs items={crumbs} /> : null;
}
