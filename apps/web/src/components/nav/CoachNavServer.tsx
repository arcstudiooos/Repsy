import { prisma } from '@repsy/db';
import type { ReactNode } from 'react';
import { getCoachShellData } from '@/server/coachShellData';
import { getServerSession } from '@/server/serverActor';
import { canSwitchWorkspace } from '@/server/shellGate';
import { CoachNav } from './CoachNav';

/**
 * Loads what the coach rail shows besides links: badge counts (open review items, unread messages) and the user
 * card (name, workspace, whether it can switch). Any failure leaves the rail without them rather than breaking the page. Reads the session: render in Suspense.
 */
export async function CoachNavServer({ switcher }: { switcher?: ReactNode }) {
  const { user, memberships } = await getServerSession();
  const data = user ? await getCoachShellData() : null;
  const me = user
    ? await prisma.user
        .findUnique({ where: { id: user.id }, select: { name: true } })
        .catch(() => null)
    : null;
  return (
    <CoachNav
      switcher={switcher}
      counts={data ? { review: data.review ?? 0, messages: data.messages ?? 0 } : undefined}
      user={
        user
          ? {
              name: me?.name?.trim() || user.email,
              org: data?.org?.name ?? null,
              canSwitch: canSwitchWorkspace(memberships),
            }
          : undefined
      }
    />
  );
}
