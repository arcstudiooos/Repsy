import Link from 'next/link';

export interface Crumb {
  label: string;
  /** Omit on the current page. */
  href?: string;
}

/** Breadcrumb trail for nested routes; the last crumb is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-secondary">
      <ol className="flex flex-wrap items-center gap-x-2">
        {items.map((crumb, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${crumb.label}`} className="flex items-center gap-2">
              {last || !crumb.href ? (
                <span aria-current={last ? 'page' : undefined} className="text-ink">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-ink md:min-h-6"
                >
                  {crumb.label}
                </Link>
              )}
              {!last && <span aria-hidden>/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
