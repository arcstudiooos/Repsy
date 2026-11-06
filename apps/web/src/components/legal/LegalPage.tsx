import Link from 'next/link';
import type { ReactNode } from 'react';
import { RepsyLogo } from '@/components/brand/Logo';

export const LEGAL_UPDATED = '2026-11-06';
export const LEGAL_CONTACT = 'hello@repsy.fit';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** Shared layout for the public legal pages (Terms, Privacy): same shell and type scale as /plan and /changelog. */
export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link href="/" aria-label="Repsy home" className="mb-8 inline-flex">
        <RepsyLogo />
      </Link>
      <h1 className="mb-2 text-3xl font-semibold">{title}</h1>
      <p className="mb-6 text-sm text-secondary">
        Last updated <time dateTime={LEGAL_UPDATED}>6 November 2026</time>
      </p>
      <div className="mb-8 text-secondary [&_a]:text-accent [&_a]:underline">{intro}</div>
      <nav aria-label="On this page" className="mb-10 rounded-card bg-surface p-4 shadow-card">
        <p className="mb-2 text-sm font-medium">On this page</p>
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-accent underline-offset-4 hover:underline">
                {i + 1}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex flex-col gap-8">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-6">
            <h2 id={`${s.id}-h`} className="mb-3 text-xl font-semibold">
              {i + 1}. {s.title}
            </h2>
            <div className="flex flex-col gap-3 leading-relaxed [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
              {s.body}
            </div>
          </section>
        ))}
      </div>
      <footer className="mt-12 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-6 text-sm text-secondary">
        <Link href="/terms" className="hover:text-ink">
          Terms of Service
        </Link>
        <Link href="/privacy" className="hover:text-ink">
          Privacy Policy
        </Link>
        <Link href="/plan" className="hover:text-ink">
          Plan and billing
        </Link>
        <a href={`mailto:${LEGAL_CONTACT}`} className="hover:text-ink">
          {LEGAL_CONTACT}
        </a>
      </footer>
    </main>
  );
}

/** "Terms of Service · Privacy Policy" links for forms and footers. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <p className={className}>
      <Link href="/terms" className="underline underline-offset-4 hover:text-ink">
        Terms of Service
      </Link>
      {' · '}
      <Link href="/privacy" className="underline underline-offset-4 hover:text-ink">
        Privacy Policy
      </Link>
    </p>
  );
}
