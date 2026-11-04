'use client';

import { Check, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import type { MessageAnchor } from '@kinetic/core';
import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react';
import { fillPlaceholders } from '@kinetic/core/reply-fill';
import type { MessageView, SavedReplyView } from '@kinetic/core';
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
  savedReplies,
  replyFacts,
  anchor: initialAnchor = null,
  links,
}: {
  /** PRD H3: what the next message is about (from a "Message about this" link), removable. */
  anchor?: MessageAnchor | null;
  /** Where an anchor chip links: the client's portal, or a coach's view of this client. */
  links?: { mode: 'portal' } | { mode: 'coach'; clientId: string };
  threadId: string;
  canPost: boolean;
  /** The other person's name, for the empty state. */
  otherName: string;
  initial: MessageView[];
  initialCursor: string | null;
  /** Coach side only (PRD H4): snippets to insert, `{first_name}` filled with the client's first name. */
  savedReplies?: SavedReplyView[];
  /** Coach side (PRD F7): values for `{workouts_done}`, `{weight}` and the other saved-reply placeholders. */
  replyFacts?: Partial<Record<string, string>>;
}) {
  const id = useId();
  const [messages, setMessages] = useState(() => merge([], initial));
  const [cursor, setCursor] = useState(initialCursor);
  const [body, setBody] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [about, setAbout] = useState<MessageAnchor | null>(initialAnchor);
  // PRD H2: an uploaded photo or PDF waiting to be sent.
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  async function attach(f: File) {
    setUploading(true);
    setError(null);
    const qs = new URLSearchParams({
      purpose: 'message',
      ...(links?.mode === 'coach' ? { clientId: links.clientId } : {}),
    });
    const res = await fetch(`/api/v1/media?${qs}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' },
      body: f,
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as {
      data?: { id: string };
      error?: { message?: string; fieldErrors?: Record<string, string[]> };
    } | null;
    setUploading(false);
    if (res?.ok && json?.data) setFile({ id: json.data.id, name: f.name });
    else
      setError(
        json?.error?.fieldErrors?.file?.[0] ??
          json?.error?.message ??
          "The file couldn't be attached.",
      );
  }
  const hrefOf = (a: MessageAnchor): string | null => {
    if (!links) return null;
    if (links.mode === 'portal') {
      return a.type === 'session' ? `/portal/workouts/${a.id}` : `/portal/check-ins/${a.id}`;
    }
    return a.type === 'session'
      ? `/app/clients/${links.clientId}/sessions/${a.id}`
      : `/app/clients/${links.clientId}/check-ins`;
  };
  const bottom = useRef<HTMLLIElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetchMessages(threadId);
    if (res.ok) setMessages((m) => merge(m, res.data.items));
  }, [threadId]);

  // A poll marks the other party's messages read, so it runs only while the thread is on screen (PR #2 review B
  // M-6): a background tab never reads for the user. Coming back refreshes at once.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
    if (!text && !file) {
      setError('Write a message.');
      return;
    }
    setSending(true);
    setError(null);
    // The same key on a retry: a resend after a lost response stores one message.
    const res = await postMessage(
      threadId,
      text,
      key,
      about ? { type: about.type, id: about.id } : undefined,
      file?.id,
    );
    setSending(false);
    if (res.ok) {
      setMessages((m) => merge(m, [res.data]));
      setBody('');
      setAbout(null);
      setFile(null);
      setKey(crypto.randomUUID());
      requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: 'end' }));
    } else {
      setError(res.fieldErrors?.body?.[0] ?? res.fieldErrors?.anchor?.[0] ?? res.message);
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
          {messages.map((m, i) => {
            const day = new Date(m.createdAt).toDateString();
            const prevDay = i > 0 ? new Date(messages[i - 1]!.createdAt).toDateString() : null;
            return (
              <Fragment key={m.id}>
                {day !== prevDay && (
                  <li
                    aria-hidden
                    className="my-1 flex items-center gap-3 text-micro text-secondary"
                  >
                    <span className="h-px flex-1 bg-border" />
                    {new Date(m.createdAt).toLocaleDateString('en-GB', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                    <span className="h-px flex-1 bg-border" />
                  </li>
                )}
                <li className={cn('flex flex-col gap-1', m.mine ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] px-4 py-2.5 break-words whitespace-pre-line',
                      m.mine
                        ? 'rounded-2xl rounded-br-md bg-accent-soft text-ink'
                        : 'rounded-2xl rounded-bl-md bg-surface-2 text-ink',
                    )}
                  >
                    {m.anchor && <AnchorChip anchor={m.anchor} href={hrefOf(m.anchor)} />}
                    <span className="sr-only">{m.mine ? 'You' : m.senderName}: </span>
                    {m.body}
                    {m.attachment && <Attachment a={m.attachment} />}
                  </div>
                  <p className="flex items-center gap-1 text-xs text-secondary">
                    {m.mine ? 'You' : m.senderName} ·{' '}
                    <time dateTime={m.createdAt}>{timeLabel(m.createdAt)}</time>
                    {m.mine && (
                      <>
                        {' '}
                        ·{' '}
                        {m.readAt ? (
                          <CheckCheck aria-hidden className="size-3.5 text-cyan-strong" />
                        ) : (
                          <Check aria-hidden className="size-3.5" />
                        )}
                        {m.readAt ? 'Read' : 'Sent'}
                      </>
                    )}
                  </p>
                </li>
              </Fragment>
            );
          })}
          <li ref={bottom} aria-hidden />
        </ol>
      )}
      {canPost ? (
        <form
          className="sticky bottom-20 z-10 flex flex-col gap-2 rounded-card border border-border bg-surface p-3 shadow-e2 md:bottom-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex flex-wrap items-end justify-between gap-2">
            <label htmlFor={id} className="text-sm font-medium">
              Message
            </label>
            {savedReplies && savedReplies.length > 0 && (
              <select
                aria-label="Insert a saved reply"
                value=""
                onChange={(e) => {
                  const r = savedReplies.find((x) => x.id === e.target.value);
                  if (!r) return;
                  const first = otherName.trim().split(/\s+/)[0] || otherName;
                  const text = fillPlaceholders(r.body, { first_name: first, ...replyFacts });
                  setBody((b) => (b.trim() ? `${b}\n${text}` : text).slice(0, MAX));
                }}
                className="min-h-11 rounded-control border border-input-border bg-surface px-3 text-sm text-ink"
              >
                <option value="">Insert a saved reply…</option>
                {savedReplies.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-accent underline has-focus-visible:outline-2 has-focus-visible:outline-accent">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void attach(f);
                }}
              />
              {uploading ? 'Attaching…' : 'Attach a photo or PDF'}
            </label>
            {file && (
              <>
                <span className="font-medium break-all">Attached: {file.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove attachment ${file.name}`}
                  onClick={() => setFile(null)}
                >
                  Remove
                </Button>
              </>
            )}
          </div>
          {about && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-control bg-surface-2 px-2 py-1 font-medium">
                Re: {about.label}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove Re: ${about.label}`}
                onClick={() => setAbout(null)}
              >
                Remove
              </Button>
            </p>
          )}
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

/** PRD H3: "Re: Upper A, Tue 3 Nov", linking to the workout or check-in. */
function AnchorChip({ anchor, href }: { anchor: MessageAnchor; href: string | null }) {
  const cls = 'mb-1 inline-block rounded-control bg-surface px-2 py-0.5 text-xs font-medium';
  return (
    <span className="block">
      {href ? (
        <Link href={href} className={`${cls} text-accent underline`}>
          Re: {anchor.label}
        </Link>
      ) : (
        <span className={cls}>Re: {anchor.label}</span>
      )}
    </span>
  );
}

/** PRD H2: a photo shows inline (opens full size); a PDF is a download link. */
function Attachment({ a }: { a: { mediaId: string; contentType: string } }) {
  const href = `/api/v1/media/${a.mediaId}`;
  if (a.contentType === 'application/pdf') {
    return (
      <a href={href} className="mt-1 block text-accent underline">
        PDF attachment
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener" className="mt-1 block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={href} alt="Photo attachment" loading="lazy" className="max-h-64 rounded-control" />
    </a>
  );
}
