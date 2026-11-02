import Link from 'next/link';
import type { ChallengeSummary } from '@kinetic/core';

const STATUS = { upcoming: 'Starts soon', live: 'On now', ended: 'Ended' } as const;
const day = (d: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );

export function ChallengeList({ items, base }: { items: ChallengeSummary[]; base: string }) {
  return (
    <ul aria-label="Challenges" className="flex flex-col gap-2">
      {items.map((c) => (
        <li key={c.id} className="rounded-card bg-surface p-4 shadow-card">
          <Link
            href={`${base}/${c.id}`}
            className="font-semibold underline-offset-4 hover:underline"
          >
            {c.title}
          </Link>
          <p className="text-sm text-secondary">
            {STATUS[c.status]} · {day(c.startLocalDate)} to {day(c.endLocalDate)} · {c.participants}{' '}
            {c.participants === 1 ? 'person' : 'people'}
            {c.groupName && ` · ${c.groupName}`}
            {c.joined && ' · joined'}
          </p>
        </li>
      ))}
    </ul>
  );
}

export const challengeDates = (c: ChallengeSummary) =>
  `${day(c.startLocalDate)} to ${day(c.endLocalDate)}`;
export const challengeStatus = (c: ChallengeSummary) => STATUS[c.status];
