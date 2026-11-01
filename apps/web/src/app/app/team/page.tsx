import type { Metadata } from 'next';
import { listTeam } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';
import { TeamManager } from './TeamManager';

export const metadata: Metadata = { title: 'Team | Kinetic' };

/** PRD A10: who is on the workspace's team, and (for owners and admins) inviting more. */
export default async function TeamPage() {
  const { me, role, team } = await withServerTenant(async (tx, actor) => ({
    me: actor.userId,
    role: actor.role,
    team: await listTeam(tx, actor),
  }));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Team</h1>
      <TeamManager me={me} myRole={role} members={team.members} invites={team.invites} />
    </>
  );
}
