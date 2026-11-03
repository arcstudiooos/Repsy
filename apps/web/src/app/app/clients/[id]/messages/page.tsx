import type { Metadata } from 'next';
import {
  getClientThread,
  getSettings,
  listMessages,
  listSavedReplies,
  listScheduledMessages,
  parseAnchorRef,
  replyFacts,
  resolveAnchor,
  todayInZone,
  type MessageAnchor,
} from '@kinetic/core';
import { MessageThread } from '@/components/messages/MessageThread';
import { ScheduledMessages } from '@/components/messages/ScheduledMessages';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Messages | Repsy' };

export default async function ClientMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const client = await loadClient((await params).id);
  const re = parseAnchorRef((await searchParams).re);
  const { thread, page, replies, facts, anchor, scheduled } = await withServerTenant(
    async (tx, actor) => {
      const t = await getClientThread(tx, actor, client.id);
      const units = (await getSettings(tx, actor)).profile?.units ?? client.preferredUnits;
      return {
        thread: t,
        page: await listMessages(tx, actor, t.id),
        replies: await listSavedReplies(tx, actor),
        scheduled: await listScheduledMessages(tx, actor, client.id),
        facts: await replyFacts(tx, actor, client.id, units),
        anchor: re
          ? await resolveAnchor(tx, client.id, re).catch((): MessageAnchor | null => null)
          : null,
      };
    },
  );
  return (
    <div className="flex flex-col gap-6">
      <MessageThread
        threadId={thread.id}
        canPost={thread.canPost}
        otherName={client.name}
        initial={page.items}
        initialCursor={page.nextCursor}
        savedReplies={replies}
        replyFacts={facts}
        anchor={anchor}
        links={{ mode: 'coach', clientId: client.id }}
      />
      {thread.canPost && (
        <ScheduledMessages
          clientId={client.id}
          clientName={client.name}
          timezone={client.timezone}
          today={todayInZone(client.timezone)}
          initial={scheduled}
        />
      )}
    </div>
  );
}
