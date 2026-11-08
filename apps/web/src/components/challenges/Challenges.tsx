'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { ChallengeDetail, ChallengeMetric } from '@repsy/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';
import { cn } from '@/lib/utils';

export const METRIC_LABEL: Record<ChallengeMetric, string> = {
  workouts: 'Most workouts completed',
  habit_days: 'Most days with a habit ticked off',
  volume: 'Most training volume (weight × reps)',
};
const KG_PER_LB = 0.45359237;

export function formatScore(metric: ChallengeMetric, score: number, units: 'kg' | 'lb'): string {
  if (metric === 'workouts') return `${score} ${score === 1 ? 'workout' : 'workouts'}`;
  if (metric === 'habit_days') return `${score} ${score === 1 ? 'day' : 'days'}`;
  const v = units === 'lb' ? Math.round(score / KG_PER_LB) : score;
  return `${new Intl.NumberFormat('en-GB').format(v)} ${units}`;
}

const SELECT =
  'block min-h-11 max-w-full rounded-control border border-input-border bg-surface px-3 text-base text-ink';

/** Coach: set up a challenge. */
export function NewChallengeForm({
  groups,
  today,
}: {
  groups: { id: string; name: string }[];
  today: string;
}) {
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [metric, setMetric] = useState<ChallengeMetric>('workouts');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState('');
  const [groupId, setGroupId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await call<{ id: string }>('POST', '/api/v1/challenges', {
          title,
          description,
          metric,
          startLocalDate: start,
          endLocalDate: end,
          groupId: groupId || null,
        });
        setBusy(false);
        if (!res.ok) {
          setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.message);
          return;
        }
        toast.success('Challenge created');
        router.push(`/app/challenges/${res.data.id}`);
      }}
    >
      <label htmlFor={`${id}-title`} className="text-sm font-medium">
        Challenge name
      </label>
      <Input
        id={`${id}-title`}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label htmlFor={`${id}-desc`} className="text-sm font-medium">
        Description (optional)
      </label>
      <Input
        id={`${id}-desc`}
        value={description}
        maxLength={2000}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label htmlFor={`${id}-metric`} className="text-sm font-medium">
        What counts
      </label>
      <select
        id={`${id}-metric`}
        value={metric}
        onChange={(e) => setMetric(e.target.value as ChallengeMetric)}
        className={SELECT}
      >
        {(Object.keys(METRIC_LABEL) as ChallengeMetric[]).map((m) => (
          <option key={m} value={m}>
            {METRIC_LABEL[m]}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-start`} className="text-sm font-medium">
            Starts
          </label>
          <Input
            id={`${id}-start`}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-end`} className="text-sm font-medium">
            Ends
          </label>
          <Input
            id={`${id}-end`}
            type="date"
            value={end}
            min={start}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>
      <label htmlFor={`${id}-group`} className="text-sm font-medium">
        Who can join
      </label>
      <select
        id={`${id}-group`}
        value={groupId}
        onChange={(e) => setGroupId(e.target.value)}
        className={SELECT}
      >
        <option value="">All clients</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            Group: {g.name}
          </option>
        ))}
      </select>
      <p className="text-sm text-secondary">
        Clients choose whether to appear on the leaderboard, which shows first names and initials.
        Body measurements are never ranked.
      </p>
      <div>
        <Button type="submit" disabled={busy}>
          Create challenge
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

/** The ranked list; rows for people not on the leaderboard (coaches see them; a client sees only themselves) are marked. */
export function Leaderboard({ detail, units }: { detail: ChallengeDetail; units: 'kg' | 'lb' }) {
  if (detail.leaderboard.length === 0) {
    return <p className="text-secondary">No one has joined yet.</p>;
  }
  return (
    <ol aria-label="Leaderboard" className="flex flex-col divide-y divide-divider">
      {detail.leaderboard.map((e, i) => (
        <li
          key={i}
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 py-2',
            e.me && 'font-semibold',
          )}
        >
          <span className="min-w-0 break-words">
            <span className="inline-block w-10 text-secondary">{e.rank ?? '–'}</span>
            {e.me ? `${e.name} (you)` : e.name}
            {!e.onLeaderboard && (
              <span className="text-sm font-normal text-secondary"> · not on the leaderboard</span>
            )}
          </span>
          <span>{formatScore(detail.metric, e.score, units)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Client: join, change the leaderboard choice, or leave. */
export function Participation({ detail }: { detail: ChallengeDetail }) {
  const router = useRouter();
  const [show, setShow] = useState(detail.joined ? detail.onLeaderboard : true);
  const [busy, setBusy] = useState(false);
  async function put(joined: boolean, onLeaderboard: boolean, done: string) {
    setBusy(true);
    const res = await call('PUT', `/api/v1/challenges/${detail.id}/participation`, {
      joined,
      onLeaderboard,
    });
    setBusy(false);
    if (res.ok) {
      toast.success(done);
      router.refresh();
    } else toast.error(res.message);
  }
  if (!detail.joined && detail.status === 'ended') return null;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          className="size-5 accent-accent"
          checked={show}
          disabled={busy}
          onChange={(e) => {
            setShow(e.target.checked);
            if (detail.joined) {
              void put(
                true,
                e.target.checked,
                e.target.checked ? 'You’re on the leaderboard' : 'You’re off the leaderboard',
              );
            }
          }}
        />
        Show me on the leaderboard (first name and initial)
      </label>
      <div className="flex flex-wrap gap-2">
        {detail.joined ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void put(false, false, 'You left the challenge')}
          >
            Leave the challenge
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void put(true, show, 'You joined the challenge')}>
            Join the challenge
          </Button>
        )}
      </div>
    </div>
  );
}

export function ArchiveChallenge({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      aria-label={`Delete the challenge ${title}`}
      onClick={async () => {
        if (!window.confirm(`Delete "${title}"?`)) return;
        const res = await fetch(`/api/v1/challenges/${id}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        if (res.ok) {
          toast.success('Challenge deleted');
          router.push('/app/challenges');
          router.refresh();
        } else toast.error("Couldn't delete it. Try again.");
      }}
    >
      Delete
    </Button>
  );
}
