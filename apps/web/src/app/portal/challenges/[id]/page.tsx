import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DomainError, getChallenge } from '@repsy/core';
import { challengeDates, challengeStatus } from '@/components/challenges/ChallengeList';
import { Leaderboard, METRIC_LABEL, Participation } from '@/components/challenges/Challenges';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Challenge | Repsy' };

export default async function PortalChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    data = await withPortalTenant(async (tx, actor) => ({
      detail: await getChallenge(tx, actor, id),
      units: (
        await tx.client.findFirstOrThrow({
          where: { id: actor.clientId as string },
          select: { preferredUnits: true },
        })
      ).preferredUnits as 'kg' | 'lb',
    }));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { detail, units } = data;
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold break-words md:text-3xl">{detail.title}</h1>
      <p className="mb-6 text-secondary">
        {challengeStatus(detail)} · {challengeDates(detail)} · {METRIC_LABEL[detail.metric]}
      </p>
      <div className="flex flex-col gap-6">
        {detail.description && <p className="whitespace-pre-line">{detail.description}</p>}
        <Participation detail={detail} />
        <section aria-labelledby="lb-h">
          <h2 id="lb-h" className="mb-2 text-lg font-semibold">
            Leaderboard
          </h2>
          <Leaderboard detail={detail} units={units} />
        </section>
      </div>
    </>
  );
}
