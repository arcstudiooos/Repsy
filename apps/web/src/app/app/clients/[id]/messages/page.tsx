import type { Metadata } from 'next';
import {
  getClientThread,
  getSettings,
  listMessages,
  listSavedReplies,
  replyFacts,
} from '@kinetic/core';
import { MessageThread } from '@/components/messages/MessageThread';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

export const metadata: Metadata = { title: 'Messages | Kinetic' };

export default async function ClientMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const { thread, page, replies, facts } = await withServerTenant(async (tx, actor) => {
    const t = await getClientThread(tx, actor, client.id);
    const units = (await getSettings(tx, actor)).profile?.units ?? client.preferredUnits;
    return {
      thread: t,
      page: await listMessages(tx, actor, t.id),
      replies: await listSavedReplies(tx, actor),
      facts: await replyFacts(tx, actor, client.id, units),
    };
  });
  return (
    <MessageThread
      threadId={thread.id}
      canPost={thread.canPost}
      otherName={client.name}
      initial={page.items}
      initialCursor={page.nextCursor}
      savedReplies={replies}
      replyFacts={facts}
    />
  );
}
