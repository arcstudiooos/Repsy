import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DomainError, getGroup, isUuid } from '@kinetic/core';
import { GroupView } from '@/components/groups/GroupView';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Group | Repsy' };

export default async function PortalGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const tab = (await searchParams).tab === 'chat' ? 'chat' : 'feed';
  if (!isUuid(id)) notFound();
  let detail;
  try {
    detail = await withPortalTenant((tx, actor) =>
      getGroup(tx, actor, id, tab === 'chat' ? 'chat' : 'post'),
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold break-words md:text-3xl">{detail.name}</h1>
      <p className="mb-4 text-sm text-secondary">
        Members see each other as first name and initial. Your coach moderates this group.
      </p>
      <GroupView detail={detail} tab={tab} basePath={`/portal/groups/${id}`} />
    </>
  );
}
