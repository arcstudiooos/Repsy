'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MessageView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { fetchMessages, postMessage } from '@/lib/message-api';
import { cn } from '@/lib/utils';

const MAX = 4000;
const POLL_MS = 15_000;

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Newest-first pages merged into one oldest-first list without duplicates. */
function merge(current: MessageView[], incoming: MessageView[]): MessageView[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * One conversation (S4-4): text only, oldest at the top, "Load older" for earlier pages, sent/read state on the
 * viewer's own messages. The first page reloads every 15 s while open (which also marks new messages read).
 */
export function MessageThread({
  threadId,
  canPost,
  otherName,
  initial,
  initialCursor,
}: {
  threadId: string;
  canPost: boolean;
  /** The other person's name, for the empty state. */
  otherName: string;
  initial: MessageView[];
  initialCursor: string | null;
}) {
  const id = useId();
  const [messages, setMessages] = useState(() => merge([], initial));
  const [cursor, setCursor] = useState(initialCursor);
  const [body, setBody] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const bottom = useRef<HTMLLIElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetchMessages(threadId);
    if (res.ok) setMessages((m) => merge(m, res.data.items));
  }, [threadId]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function loadOlder() {
    if (!cursor) return;
    setLoadingOlder(true);
    const res = await fetchMessages(threadId, cursor);
    setLoadingOlder(false);
    if (res.ok) {
      setMessages((m) => merge(m, res.data.items));
      setCursor(res.data.nextCursor);
    } else {
      setError(res.message);
    }
  }

  async function send() {
    const text = body.trim();
    if (!text) {
      setError('Write a message.');
      return;
    }
    setSending(true);
    setError(null);
    // The same key on a retry: a resend after a lost response stores one message.
    const res = await postMessage(threadId, text, key);
    setSending(false);
    if (res.ok) {
      setMessages((m) => merge(m, [res.data]));
      setBody('');
      setKey(crypto.randomUUID());
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: 'end' }));
    } else {
      setError(res.fieldErrors?.body?.[0] ?? res.message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {cursor && (
        <Button
          variant="secondary"
          className="self-center"
          onClick={() => void loadOlder()}
          disabled={loadingOlder}
        >
          {loadingOlder ? 'Loading…' : 'Load older messages'}
        </Button>
      )}
      {messages.length === 0 ? (
        <p className="text-secondary">No messages yet. Say hello to {otherName}.</p>
      ) : (
        <ol aria-label="Messages" className="flex flex-col gap-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className={cn('flex flex-col gap-1', m.mine ? 'items-end' : 'items-start')}
            >
              <div
                className={cn(
                  'max-w-[85%] rounded-card border px-4 py-2 break-words whitespace-pre-line',
                  m.mine ? 'border-accent bg-surface' : 'border-input-border bg-canvas',
                )}
              >
                <span className="sr-only">{m.mine ? 'You' : m.senderName}: </span>
                {m.body}
              </div>
              <p className="text-xs text-secondary">
                {m.mine ? 'You' : m.senderName} ·{' '}
                <time dateTime={m.createdAt}>{timeLabel(m.createdAt)}</time>
                {m.mine && <> · {m.readAt ? 'Read' : 'Sent'}</>}
              </p>
            </li>
          ))}
          <li ref={bottom} aria-hidden />
        </ol>
      )}
      {canPost ? (
        <form
          className="flex flex-col gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor={id} className="text-sm font-medium">
            Message
          </label>
          <textarea
            id={id}
            rows={3}
            maxLength={MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-count${error ? ` ${id}-error` : ''}`}
            className="rounded-control border border-input-border bg-surface px-3 py-2 text-base aria-invalid:border-danger"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={`${id}-count`} className="text-xs text-secondary">
              {body.length} / {MAX}
            </p>
            <Button type="submit" disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
          {error && (
            <p id={`${id}-error`} role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      ) : (
        <p className="rounded-control border border-input-border bg-surface px-3 py-2 text-secondary">
          This conversation is closed. Messages can still be read.
        </p>
      )}
    </div>
  );
}
