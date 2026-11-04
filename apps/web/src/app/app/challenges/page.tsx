import type { Metadata } from 'next';
import { listChallenges, listGroups, todayInZone, TRAINER_ROLES } from '@kinetic/core';
import { ChallengeList } from '@/components/challenges/ChallengeList';
import { NewChallengeForm } from '@/components/challenges/Challenges';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Challenges | Repsy' };

/** PRD H9: time-boxed challenges with an opt-in leaderboard. */
export default async function ChallengesPage() {
  const { items, groups, canEdit, today } = await withServerTenant(async (tx, actor) => {
    const org = await tx.organization.findFirstOrThrow({ select: { timezone: true } });
    return {
      items: await listChallenges(tx, actor),
      groups: (await listGroups(tx, actor)).map((g) => ({ id: g.id, name: g.name })),
      canEdit: (TRAINER_ROLES as readonly string[]).includes(actor.role),
      today: todayInZone(org.timezone),
    };
  });
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Challenges</h1>
      <div className="flex flex-col gap-6">
        {items.length === 0 ? (
          <p className="text-secondary">No challenges yet.</p>
        ) : (
          <ChallengeList items={items} base="/app/challenges" />
        )}
        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">New challenge</CardTitle>
            </CardHeader>
            <CardContent>
              <NewChallengeForm groups={groups} today={today} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
