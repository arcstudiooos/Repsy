import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DomainError, getChallenge, TRAINER_ROLES } from '@kinetic/core';
import { challengeDates, challengeStatus } from '@/components/challenges/ChallengeList';
import { ArchiveChallenge, Leaderboard, METRIC_LABEL } from '@/components/challenges/Challenges';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Challenge | Kinetic' };

export default async function CoachChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    data = await withServerTenant(async (tx, actor) => ({
      detail: await getChallenge(tx, actor, id),
      canEdit: (TRAINER_ROLES as readonly string[]).includes(actor.role),
    }));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { detail, canEdit } = data;
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">{detail.title}</h1>
        {canEdit && <ArchiveChallenge id={detail.id} title={detail.title} />}
      </div>
      <p className="mb-6 text-secondary">
        {challengeStatus(detail)} · {challengeDates(detail)} · {METRIC_LABEL[detail.metric]}
        {detail.groupName && ` · ${detail.groupName}`}
      </p>
      {detail.description && <p className="mb-6 whitespace-pre-line">{detail.description}</p>}
      <h2 className="mb-2 text-lg font-semibold">Leaderboard</h2>
      <Leaderboard detail={detail} units="kg" />
    </>
  );
}
