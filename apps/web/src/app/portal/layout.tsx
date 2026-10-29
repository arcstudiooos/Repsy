import type { ReactNode } from 'react';
import { PortalNav } from '@/components/nav/PortalNav';

/**
 * Client portal shell: bottom tab bar on mobile, top bar from 768px up.
 * Access is enforced by src/proxy.ts (signed in, verified); portal-specific
 * membership checks come with Sprint 1.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <header className="border-b border-divider bg-surface px-4 py-3 md:border-b-0 md:pb-0">
        <p className="mx-auto max-w-3xl text-lg font-semibold md:px-8">Kinetic</p>
      </header>
      <PortalNav />
      <main
        id="main"
        className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-24 md:px-8 md:pt-8 md:pb-8"
      >
        {children}
      </main>
    </div>
  );
}
