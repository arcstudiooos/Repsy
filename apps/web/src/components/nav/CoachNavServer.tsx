import { prisma } from '@kinetic/db';
import { countOpenFlags, unreadMessageCount } from '@kinetic/core';
import type { ReactNode } from 'react';
import { getServerSession, withServerTenant } from '@/server/serverActor';
import { canSwitchWorkspace } from '@/server/shellGate';
import { CoachNav } from './CoachNav';

/**
 * Loads what the coach rail shows besides links: badge counts (open review items, unread messages) and the user
 * card (name, workspace, whether it can switch). Any failure leaves the rail without them rather than breaking the page. Reads the session: render in Suspense.
 */
export async function CoachNavServer({ switcher }: { switcher?: ReactNode }) {
  const { user, memberships } = await getServerSession();
  const data = user
    ? await withServerTenant(async (tx, actor) => ({
        review: (await countOpenFlags(tx, actor)).total,
        messages: await unreadMessageCount(tx, actor),
        org:
          (await tx.organization.findFirst({ where: { id: actor.orgId }, select: { name: true } }))
            ?.name ?? null,
      })).catch(() => null)
    : null;
  const me = user
    ? await prisma.user
        .findUnique({ where: { id: user.id }, select: { name: true } })
        .catch(() => null)
    : null;
  return (
    <CoachNav
      switcher={switcher}
      counts={data ? { review: data.review, messages: data.messages } : undefined}
      user={
        user
          ? {
              name: me?.name?.trim() || user.email,
              org: data?.org ?? null,
              canSwitch: canSwitchWorkspace(memberships),
            }
          : undefined
      }
    />
  );
}
