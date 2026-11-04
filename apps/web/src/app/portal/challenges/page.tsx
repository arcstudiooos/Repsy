import type { Metadata } from 'next';
import { listChallenges } from '@kinetic/core';
import { ChallengeList } from '@/components/challenges/ChallengeList';
import { EmptyState } from '@/components/states/EmptyState';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Challenges | Repsy' };

export default async function PortalChallengesPage() {
  const items = await withPortalTenant((tx, actor) => listChallenges(tx, actor));
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Challenges</h1>
      {items.length === 0 ? (
        <EmptyState
          title="No challenges right now"
          body="When your coach starts a challenge, you can join it here."
        />
      ) : (
        <ChallengeList items={items} base="/portal/challenges" />
      )}
    </>
  );
}
