import type { Metadata } from 'next';
import { listCovers, listTeam, todayInZone, TRAINER_ROLES } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';
import { CoverManager } from './CoverManager';
import { TeamManager } from './TeamManager';

export const metadata: Metadata = { title: 'Team | Repsy' };

/** PRD A10: who is on the workspace's team, and (for owners and admins) inviting more. */
export default async function TeamPage() {
  const { me, role, team, covers, today } = await withServerTenant(async (tx, actor) => ({
    me: actor.userId,
    role: actor.role,
    team: await listTeam(tx, actor),
    covers: await listCovers(tx),
    today: todayInZone(
      (await tx.organization.findFirstOrThrow({ select: { timezone: true } })).timezone,
    ),
  }));
  const coaches = team.members
    .filter((m) => (TRAINER_ROLES as readonly string[]).includes(m.role))
    .map((m) => ({ userId: m.userId, name: m.name }));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Team</h1>
      <div className="flex flex-col gap-6">
        <TeamManager me={me} myRole={role} members={team.members} invites={team.invites} />
        <CoverManager me={me} myRole={role} coaches={coaches} covers={covers} today={today} />
      </div>
    </>
  );
}
