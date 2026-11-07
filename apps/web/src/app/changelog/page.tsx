import type { Metadata } from 'next';
import { CHANGELOG, ROADMAP } from '@/content/changelog';

export const metadata: Metadata = {
  title: 'What’s new | Repsy',
  description: 'What has shipped in Repsy lately, and what is on the roadmap next.',
  alternates: { canonical: '/changelog' },
};

/** PRD M13: public changelog and roadmap. */
export default function ChangelogPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-3xl font-semibold">What’s new</h1>
      <ol className="mb-10 flex flex-col gap-6">
        {CHANGELOG.map((r) => (
          <li key={r.date}>
            <h2 className="text-xl font-semibold">{r.title}</h2>
            <p className="mb-2 text-sm text-secondary">
              <time dateTime={r.date}>{r.date}</time>
            </p>
            <ul className="list-disc pl-5">
              {r.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <h2 className="mb-3 text-xl font-semibold">Coming next</h2>
      <ul className="flex flex-col gap-2">
        {ROADMAP.map((r) => (
          <li key={r.title} className="rounded-card bg-surface p-4 shadow-card">
            <p className="font-medium">{r.title}</p>
            <p className="text-secondary">{r.detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-secondary">Have an idea? Send it from Help and support in the app.</p>
    </main>
  );
}
