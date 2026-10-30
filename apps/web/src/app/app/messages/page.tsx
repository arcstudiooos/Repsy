import type { Metadata } from 'next';
import Link from 'next/link';
import { getThread, listMessages, listThreads, isUuid } from '@kinetic/core';
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
  const selected = first((await searchParams).thread);
  const { threads, open } = await withServerTenant(async (tx, actor) => {
    const list = await listThreads(tx, actor);
    const pick =
      selected && isUuid(selected) && list.some((t) => t.id === selected) ? selected : null;
    if (!pick) return { threads: list, open: null };
    const thread = await getThread(tx, actor, pick);
    const page = await listMessages(tx, actor, pick);
    // Opening the thread marked it read.
    return {
      threads: list.map((t) => (t.id === pick ? { ...t, unread: 0 } : t)),
      open: { thread, page },
    };
  });

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Messages</h1>
      {threads.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          body="Open a client's Messages tab to start one. Clients can write to you from their portal."
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <nav aria-label="Conversations" className={cn(open && 'hidden md:block')}>
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
                <h2 className="mb-4 text-lg font-semibold break-words">{open.thread.clientName}</h2>
                <MessageThread
                  key={open.thread.id}
                  threadId={open.thread.id}
                  canPost={open.thread.canPost}
                  otherName={open.thread.clientName}
                  initial={open.page.items}
                  initialCursor={open.page.nextCursor}
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
