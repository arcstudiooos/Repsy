import type { Metadata } from 'next';
import { getMyThread, listMessages } from '@kinetic/core';
import { MessageThread } from '@/components/messages/MessageThread';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Messages | Kinetic' };

// Access is enforced by src/proxy.ts and the portal layout's client gate; core scopes to this client's thread.
export default async function PortalMessages() {
  const { thread, page, coachName } = await withPortalTenant(async (tx, actor) => {
    const t = await getMyThread(tx, actor);
    const client = await tx.client.findFirst({
      where: { id: actor.clientId },
      select: { coach: { select: { name: true } } },
    });
    return {
      thread: t,
      page: await listMessages(tx, actor, t.id),
      coachName: (client?.coach as { name: string } | null)?.name ?? 'your coach',
    };
  });
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Messages</h1>
      <p className="mb-6 text-secondary">Your conversation with {coachName}.</p>
      <MessageThread
        threadId={thread.id}
        canPost={thread.canPost}
        otherName={coachName}
        initial={page.items}
        initialCursor={page.nextCursor}
      />
    </>
  );
}
