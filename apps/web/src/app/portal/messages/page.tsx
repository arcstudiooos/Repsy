import type { Metadata } from 'next';
import {
  getMyThread,
  getReplyExpectations,
  listMessages,
  parseAnchorRef,
  resolveAnchor,
  type MessageAnchor,
} from '@kinetic/core';
import { MessageThread } from '@/components/messages/MessageThread';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Messages | Repsy' };

// Access is enforced by src/proxy.ts and the portal layout's client gate; core scopes to this client's thread.
export default async function PortalMessages({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const re = parseAnchorRef((await searchParams).re);
  const { thread, page, coachName, expectations, anchor } = await withPortalTenant(
    async (tx, actor) => {
      const t = await getMyThread(tx, actor);
      const client = await tx.client.findFirst({
        where: { id: actor.clientId },
        select: { coach: { select: { name: true } } },
      });
      return {
        thread: t,
        page: await listMessages(tx, actor, t.id),
        coachName: (client?.coach as { name: string } | null)?.name ?? 'your coach',
        expectations: await getReplyExpectations(tx, actor),
        // PRD H3: "Message about this" from a workout or check-in; anything not theirs is dropped.
        anchor:
          re && actor.clientId
            ? await resolveAnchor(tx, actor.clientId, re).catch((): MessageAnchor | null => null)
            : null,
      };
    },
  );
  return (
    <>
      <h1 className="mb-2 text-h1 font-semibold md:text-display">Messages</h1>
      <p
        className={
          expectations.replyTargetHours || expectations.officeHours
            ? 'mb-2 text-secondary'
            : 'mb-6 text-secondary'
        }
      >
        Your conversation with {coachName}.
      </p>
      {(expectations.replyTargetHours || expectations.officeHours) && (
        <p className="mb-6 text-secondary">
          {expectations.replyTargetHours &&
            `Your coach usually replies within ${expectations.replyTargetHours} hours.`}
          {expectations.replyTargetHours && expectations.officeHours && ' '}
          {expectations.officeHours && `Office hours: ${expectations.officeHours}.`}
        </p>
      )}
      <MessageThread
        threadId={thread.id}
        canPost={thread.canPost}
        otherName={coachName}
        initial={page.items}
        initialCursor={page.nextCursor}
        anchor={anchor}
        links={{ mode: 'portal' }}
      />
    </>
  );
}
