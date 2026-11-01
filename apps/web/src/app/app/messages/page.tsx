import type { Metadata } from 'next';
import Link from 'next/link';
import {
  broadcastAudiences,
  getClientContext,
  getSettings,
  replyFacts,
  DomainError,
  getThread,
  isUuid,
  listMessages,
  listSavedReplies,
  listThreads,
  searchMessages,
  type MessageSearchHit,
} from '@kinetic/core';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BroadcastDialog } from '@/components/messages/BroadcastDialog';
import { MessageThread } from '@/components/messages/MessageThread';
import { EmptyState } from '@/components/states/EmptyState';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Messages | Kinetic' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Coach inbox (S4-4): threads on the left, the open one on the right; one view at a time on mobile. */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const selected = first(sp.thread);
  const q = first(sp.q)?.trim().slice(0, 100) || undefined;
  const { threads, open, hits, searchError, replies, audiences } = await withServerTenant(
    async (tx, actor) => {
      const replies = await listSavedReplies(tx, actor);
      const audiences = await broadcastAudiences(tx, actor);
      let hits: MessageSearchHit[] | null = null;
      let searchError: string | null = null;
      if (q !== undefined) {
        try {
          hits = await searchMessages(tx, actor, { q });
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== 'VALIDATION') throw error;
          searchError = 'Search with at least 2 characters.';
        }
      }
      const list = await listThreads(tx, actor);
      const pick =
        selected && isUuid(selected) && list.some((t) => t.id === selected) ? selected : null;
      if (!pick) return { threads: list, open: null, hits, searchError, replies, audiences };
      const thread = await getThread(tx, actor, pick);
      const page = await listMessages(tx, actor, pick);
      const units = (await getSettings(tx, actor)).profile?.units ?? 'kg';
      const facts = await replyFacts(tx, actor, thread.clientId, units);
      const context = await getClientContext(tx, actor, thread.clientId);
      // Opening the thread marked it read.
      return {
        threads: list.map((t) => (t.id === pick ? { ...t, unread: 0 } : t)),
        open: { thread, page, facts, context },
        hits,
        searchError,
        replies,
        audiences,
      };
    },
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Messages</h1>
        <BroadcastDialog audiences={audiences} />
      </div>
      {threads.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          body="Open a client's Messages tab to start one. Clients can write to you from their portal."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <nav
            aria-label="Conversations"
            className={cn('flex flex-col gap-3', open && 'hidden md:flex')}
          >
            <form role="search" action="/app/messages" className="flex gap-2">
              <Input
                type="search"
                name="q"
                defaultValue={q ?? ''}
                aria-label="Search messages"
                placeholder="Search messages"
              />
              <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                Search
              </button>
            </form>
            {searchError && (
              <p role="alert" className="text-sm text-danger">
                {searchError}
              </p>
            )}
            {hits && (
              <Card className="p-2 sm:p-2">
                <h2 className="px-3 py-2 text-sm font-medium text-secondary">
                  {hits.length === 0
                    ? 'No messages match.'
                    : `${hits.length}${hits.length === 50 ? '+' : ''} ${hits.length === 1 ? 'message' : 'messages'} found`}
                </h2>
                <ul aria-label="Search results" className="flex flex-col">
                  {hits.map((h) => (
                    <li key={h.messageId}>
                      <Link
                        href={`/app/messages?thread=${h.threadId}&q=${encodeURIComponent(q ?? '')}`}
                        className="flex min-h-14 flex-col justify-center gap-0.5 rounded-control px-3 py-2 hover:bg-canvas"
                      >
                        <span className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-medium break-words">{h.clientName}</span>
                          <time dateTime={h.createdAt} className="text-secondary">
                            {new Date(h.createdAt).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </time>
                        </span>
                        <span className="line-clamp-2 text-sm text-secondary">
                          {h.mine ? 'You: ' : ''}
                          {h.body}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/app/messages"
                  className="inline-flex min-h-11 items-center px-3 text-sm text-accent underline"
                >
                  Clear search
                </Link>
              </Card>
            )}
            <Card className="p-2 sm:p-2">
              <ul className="flex flex-col">
                {threads.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/app/messages?thread=${t.id}`}
                      aria-current={open?.thread.id === t.id ? 'page' : undefined}
                      className={cn(
                        'flex min-h-14 flex-col justify-center gap-0.5 rounded-control px-3 py-2 hover:bg-canvas',
                        open?.thread.id === t.id && 'bg-canvas',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium break-words">{t.clientName}</span>
                        {t.unread > 0 && (
                          <span className="rounded-control bg-accent px-2 text-sm text-white">
                            {t.unread} unread
                          </span>
                        )}
                      </span>
                      {t.lastMessage && (
                        <span className="truncate text-sm text-secondary">
                          {t.lastMessage.mine ? 'You: ' : ''}
                          {t.lastMessage.body}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </nav>
          <section aria-label="Conversation" className={cn(!open && 'hidden md:block')}>
            {open ? (
              <>
                <Link
                  href="/app/messages"
                  className="mb-3 inline-flex min-h-11 items-center text-accent underline underline-offset-4 md:hidden"
                >
                  All conversations
                </Link>
                <h2 className="mb-2 text-lg font-semibold break-words">{open.thread.clientName}</h2>
                {(open.context.goals || open.context.motivation) && (
                  <dl className="mb-4 grid gap-2 rounded-control bg-canvas p-3 text-sm sm:grid-cols-2">
                    {open.context.goals && (
                      <div>
                        <dt className="text-secondary">Goals</dt>
                        <dd className="break-words whitespace-pre-line">{open.context.goals}</dd>
                      </div>
                    )}
                    {open.context.motivation && (
                      <div>
                        <dt className="text-secondary">Motivation</dt>
                        <dd className="break-words whitespace-pre-line">
                          {open.context.motivation}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
                <MessageThread
                  key={open.thread.id}
                  threadId={open.thread.id}
                  canPost={open.thread.canPost}
                  otherName={open.thread.clientName}
                  initial={open.page.items}
                  initialCursor={open.page.nextCursor}
                  savedReplies={replies}
                  replyFacts={open.facts}
                />
              </>
            ) : (
              <p className="text-secondary">Choose a conversation.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
