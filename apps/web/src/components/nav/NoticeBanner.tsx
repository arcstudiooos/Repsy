import Link from 'next/link';
import { readNotices } from '@kinetic/core';

const LABEL = {
  maintenance: 'Planned maintenance',
  degraded: 'Some things are slow',
  outage: 'Outage',
} as const;

/** PRD M8: open incident or maintenance notices, at the top of every app page. */
export async function NoticeBanner() {
  const { open } = await readNotices().catch(() => ({ open: [] }));
  if (open.length === 0) return null;
  return (
    <div role="status" className="mb-6 flex flex-col gap-2">
      {open.map((n) => (
        <div key={n.id} className="rounded-card bg-surface p-4 shadow-card ring-1 ring-warning">
          <p className="font-medium">{LABEL[n.severity]}</p>
          <p className="text-sm">
            {n.message}{' '}
            <Link href="/status" className="text-accent underline">
              Status page
            </Link>
          </p>
        </div>
      ))}
    </div>
  );
}
