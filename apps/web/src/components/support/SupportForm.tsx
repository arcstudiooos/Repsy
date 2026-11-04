'use client';

import { useSearchParams } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { call } from '@/lib/checkin-api';

const TOPICS = [
  ['question', 'A question'],
  ['problem', 'Something isn’t working'],
  ['idea', 'An idea or request'],
  ['billing', 'Plan or billing'],
  ['privacy', 'Privacy or my data'],
  ['migration', 'Move my clients and programs to Kinetic'],
] as const;
type Topic = (typeof TOPICS)[number][0];

/** PRD M13: a message to support, answered by email. */
export function SupportForm({
  responseTarget,
  coach = false,
}: {
  responseTarget: string;
  /** PRD M4: coaches can ask for the free concierge migration. */
  coach?: boolean;
}) {
  const id = useId();
  const asked = useSearchParams().get('topic');
  const topics = TOPICS.filter(([v]) => coach || v !== 'migration');
  const initial: Topic = topics.some(([v]) => v === asked) ? (asked as Topic) : 'question';
  const [topic, setTopic] = useState<Topic>(initial);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await call('POST', '/api/v1/support', {
      topic: String(data.get('topic')),
      message: String(data.get('message') ?? ''),
    });
    setBusy(false);
    if (res.ok) setSent(true);
    else setError(res.fieldErrors?.message?.[0] ?? res.message);
  }
  if (sent) {
    return (
      <p role="status" className="rounded-card bg-surface p-4 shadow-card">
        Thanks, we have your message and will reply to your account email. {responseTarget}
      </p>
    );
  }
  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card"
    >
      <p className="text-sm text-secondary">{responseTarget}</p>
      <label htmlFor={`${id}-topic`} className="text-sm font-medium">
        Topic
      </label>
      <select
        id={`${id}-topic`}
        name="topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value as Topic)}
        className="block min-h-11 rounded-control border border-input-border bg-surface px-3 text-base text-ink"
      >
        {topics.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-message`} className="text-sm font-medium">
        Message
      </label>
      <textarea
        id={`${id}-message`}
        name="message"
        rows={6}
        maxLength={5000}
        placeholder={
          topic === 'migration'
            ? 'Which app are you moving from, and about how many clients and programs? We move them for you, free, for paying workspaces.'
            : undefined
        }
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        className="rounded-control border border-input-border bg-surface px-3 py-2 text-base"
      />
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? 'Sending...' : 'Send to support'}
        </Button>
      </div>
    </form>
  );
}
