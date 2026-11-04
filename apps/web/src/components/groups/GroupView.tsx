'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import type { GroupCommentView, GroupDetail, GroupItem, Reaction } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { call } from '@/lib/checkin-api';
import { cn } from '@/lib/utils';

const REACTION_LABEL: Record<Reaction, string> = {
  like: '👍 Like',
  clap: '👏 Clap',
  strong: '💪 Strong',
  fire: '🔥 Fire',
};
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
const TEXTAREA =
  'w-full rounded-control border border-input-border bg-surface px-3 py-2 text-base text-ink';

function useAct() {
  const router = useRouter();
  return async (
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    done?: string,
  ): Promise<boolean> => {
    const res =
      method === 'DELETE'
        ? await fetch(path, { method, credentials: 'same-origin' }).then((r) => ({
            ok: r.ok,
            message: "That didn't work. Try again.",
          }))
        : await call(method, path, body);
    if (!res.ok) {
      toast.error(res.message);
      return false;
    }
    if (done) toast.success(done);
    router.refresh();
    return true;
  };
}

function Composer({
  label,
  button,
  path,
  body,
  rows = 2,
}: {
  label: string;
  button: string;
  path: string;
  body: (text: string) => unknown;
  rows?: number;
}) {
  const id = useId();
  const act = useAct();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        const ok = await act('POST', path, body(text));
        setBusy(false);
        if (ok) setText('');
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        maxLength={4000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={TEXTAREA}
      />
      <div>
        <Button type="submit" disabled={busy || !text.trim()}>
          {button}
        </Button>
      </div>
    </form>
  );
}

function Actions({
  item,
  what,
  detail,
}: {
  item: GroupCommentView;
  what: 'post' | 'comment';
  detail: GroupDetail;
}) {
  const act = useAct();
  const target = what === 'post' ? { postId: item.id } : { commentId: item.id };
  const short = item.body.length > 30 ? `${item.body.slice(0, 30)}…` : item.body;
  return (
    <div className="flex flex-wrap gap-1">
      {detail.isCoach && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${item.hidden ? 'Show again' : 'Hide'}: ${what} by ${item.author}, ${short}`}
          onClick={() =>
            void act(
              'PUT',
              '/api/v1/group-moderation',
              { ...target, hidden: !item.hidden },
              item.hidden ? 'Shown again' : 'Hidden from members',
            )
          }
        >
          {item.hidden ? 'Show again' : 'Hide'}
        </Button>
      )}
      {!detail.isCoach && !item.mine && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Report: ${what} by ${item.author}, ${short}`}
          onClick={() => {
            const reason = window.prompt('Why are you reporting this? (optional)') ?? null;
            if (reason === null) return;
            void act(
              'POST',
              '/api/v1/group-reports',
              { ...target, reason },
              'Reported to your coach',
            );
          }}
        >
          Report
        </Button>
      )}
      {!detail.isCoach && !item.mine && !item.byCoach && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Mute ${item.author}`}
          onClick={() =>
            void act(
              'PUT',
              `/api/v1/group-mutes/${item.authorUserId}`,
              { on: true },
              `${item.author} muted`,
            )
          }
        >
          Mute
        </Button>
      )}
    </div>
  );
}

function Byline({ item }: { item: GroupCommentView }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-secondary">
      <span className="font-medium text-ink">{item.author}</span>
      {item.byCoach && <span className="rounded-full bg-canvas px-2 text-xs">Coach</span>}
      <time dateTime={item.createdAt}>{when(item.createdAt)}</time>
      {item.hidden && (
        <span className="rounded-full border border-danger px-2 text-xs text-danger">Hidden</span>
      )}
    </p>
  );
}

function Post({ item, detail }: { item: GroupItem; detail: GroupDetail }) {
  const act = useAct();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Byline item={item} />
        <p className="break-words whitespace-pre-line">{item.body}</p>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={`Reactions to ${item.author}'s post`}
        >
          {item.reactions.map((r) => (
            <button
              key={r.kind}
              type="button"
              aria-pressed={r.mine}
              onClick={() =>
                void act('PUT', `/api/v1/group-posts/${item.id}/reactions`, {
                  kind: r.kind,
                  on: !r.mine,
                })
              }
              className={cn(
                'min-h-11 rounded-full border px-3 text-sm',
                r.mine ? 'border-accent bg-canvas' : 'border-divider',
              )}
            >
              {REACTION_LABEL[r.kind]}
              {r.count > 0 && ` ${r.count}`}
            </button>
          ))}
        </div>
        <Actions item={item} what="post" detail={detail} />
        {item.comments.length > 0 && (
          <ul
            aria-label={`Comments on ${item.author}'s post`}
            className="flex flex-col gap-2 border-l-2 border-divider pl-3"
          >
            {item.comments.map((c) => (
              <li key={c.id} className="flex flex-col gap-1">
                <Byline item={c} />
                <p className="break-words whitespace-pre-line">{c.body}</p>
                <Actions item={c} what="comment" detail={detail} />
              </li>
            ))}
          </ul>
        )}
        {!item.hidden && (
          <Composer
            label={`Comment on ${item.author}'s post`}
            button="Comment"
            path={`/api/v1/group-posts/${item.id}/comments`}
            body={(body) => ({ body })}
            rows={1}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** PRD H7, H8: a group's feed or chat, with moderation for coaches. */
export function GroupView({
  detail,
  tab,
  basePath,
}: {
  detail: GroupDetail;
  tab: 'feed' | 'chat';
  basePath: string;
}) {
  const router = useRouter();
  const act = useAct();
  // The chat refreshes itself while open.
  useEffect(() => {
    if (tab !== 'chat') return;
    const t = window.setInterval(() => router.refresh(), 20_000);
    return () => window.clearInterval(t);
  }, [tab, router]);
  return (
    <div className="flex flex-col gap-6">
      {detail.description && <p className="text-secondary">{detail.description}</p>}
      <nav aria-label="Group sections" className="flex gap-2">
        {(['feed', 'chat'] as const).map((t) => (
          <Link
            key={t}
            href={`${basePath}?tab=${t}`}
            aria-current={tab === t ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full px-4',
              tab === t ? 'bg-accent-fill text-on-accent' : 'border border-divider',
            )}
          >
            {t === 'feed' ? 'Feed' : 'Chat'}
          </Link>
        ))}
      </nav>
      {detail.isCoach && detail.reports.length > 0 && (
        <section
          aria-labelledby="reports-h"
          className="flex flex-col gap-3 rounded-card border border-danger p-4"
        >
          <h2 id="reports-h" className="font-semibold">
            Reported ({detail.reports.length})
          </h2>
          <ul className="flex flex-col gap-3">
            {detail.reports.map((r) => (
              <li key={r.id} className="flex flex-col gap-1">
                <p className="text-sm text-secondary">
                  {r.what === 'post' ? 'Post' : 'Comment'} by {r.author}
                  {r.reason && ` · “${r.reason}”`}
                </p>
                <p className="break-words whitespace-pre-line">{r.body}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void act(
                        'PUT',
                        '/api/v1/group-moderation',
                        { [r.what === 'post' ? 'postId' : 'commentId']: r.itemId, hidden: true },
                        'Hidden from members',
                      )
                    }
                  >
                    Hide it
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void act('DELETE', `/api/v1/group-reports/${r.id}`, null, 'Report dismissed')
                    }
                  >
                    Keep it
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tab === 'feed' ? (
        <>
          <Composer
            label="Share with the group"
            button="Post"
            path={`/api/v1/groups/${detail.id}/posts`}
            body={(body) => ({ kind: 'post', body })}
            rows={3}
          />
          {detail.items.length === 0 ? (
            <p className="text-secondary">No posts yet. Start the conversation.</p>
          ) : (
            <ul aria-label="Posts" className="flex flex-col gap-4">
              {detail.items.map((item) => (
                <li key={item.id}>
                  <Post item={item} detail={detail} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {detail.items.length === 0 ? (
            <p className="text-secondary">No messages yet.</p>
          ) : (
            <ol aria-label="Chat" className="flex flex-col gap-3">
              {detail.items.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    'flex max-w-prose flex-col gap-1 rounded-card p-3',
                    item.mine ? 'self-end bg-canvas' : 'bg-surface shadow-card',
                  )}
                >
                  <Byline item={item} />
                  <p className="break-words whitespace-pre-line">{item.body}</p>
                  <Actions item={item} what="post" detail={detail} />
                </li>
              ))}
            </ol>
          )}
          <Composer
            label="Message the group"
            button="Send"
            path={`/api/v1/groups/${detail.id}/posts`}
            body={(body) => ({ kind: 'chat', body })}
          />
        </>
      )}
      {!detail.isCoach && detail.muted.length > 0 && <MutedList detail={detail} />}
    </div>
  );
}

function MutedList({ detail }: { detail: GroupDetail }) {
  const act = useAct();
  const names = new Map(detail.members.flatMap((m) => (m.userId ? [[m.userId, m.name]] : [])));
  return (
    <section aria-labelledby="muted-h" className="flex flex-col gap-2">
      <h2 id="muted-h" className="font-semibold">
        Muted
      </h2>
      <ul className="flex flex-col gap-1">
        {detail.muted.map((u) => (
          <li key={u} className="flex items-center gap-2">
            <span>{names.get(u) ?? 'A former member'}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Unmute ${names.get(u) ?? 'this person'}`}
              onClick={() => void act('PUT', `/api/v1/group-mutes/${u}`, { on: false }, 'Unmuted')}
            >
              Unmute
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
