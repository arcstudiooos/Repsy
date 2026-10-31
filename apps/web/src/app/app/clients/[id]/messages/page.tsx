import type { Metadata } from 'next';
import { getClientThread, listMessages } from '@kinetic/core';
import { MessageThread } from '@/components/messages/MessageThread';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

export const metadata: Metadata = { title: 'Messages | Kinetic' };

export default async function ClientMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const { thread, page } = await withServerTenant(async (tx, actor) => {
    const t = await getClientThread(tx, actor, client.id);
    return { thread: t, page: await listMessages(tx, actor, t.id) };
  });
  return (
    <MessageThread
      threadId={thread.id}
      canPost={thread.canPost}
      otherName={client.name}
      initial={page.items}
      initialCursor={page.nextCursor}
    />
  );
}
