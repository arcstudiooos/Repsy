import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError, getGroup, isUuid, TRAINER_ROLES } from '@repsy/core';
import { ArchiveGroup, GroupMembers } from '@/components/groups/GroupForms';
import { GroupView } from '@/components/groups/GroupView';
import { cn } from '@/lib/utils';
import { loadActiveClients } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Group | Repsy' };

export default async function CoachGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const t = (await searchParams).tab;
  const tab = t === 'chat' ? 'chat' : t === 'members' ? 'members' : 'feed';
  if (!isUuid(id)) notFound();
  let data;
  try {
    data = await withServerTenant(async (tx, actor) => ({
      detail: await getGroup(tx, actor, id, tab === 'chat' ? 'chat' : 'post'),
      clients:
        tab === 'members'
          ? (await loadActiveClients(tx, actor)).items.map((c) => ({ id: c.id, name: c.name }))
          : [],
      canEdit: (TRAINER_ROLES as readonly string[]).includes(actor.role),
    }));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { detail, clients, canEdit } = data;
  const base = `/app/groups/${id}`;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">{detail.name}</h1>
        {canEdit && <ArchiveGroup id={detail.id} name={detail.name} />}
      </div>
      <p className="mb-4 text-sm text-secondary">
        {detail.members.length} {detail.members.length === 1 ? 'member' : 'members'} ·{' '}
        {canEdit && (
          <Link
            href={`${base}?tab=members`}
            aria-current={tab === 'members' ? 'page' : undefined}
            className={cn(
              'text-accent underline underline-offset-4',
              tab === 'members' && 'font-semibold',
            )}
          >
            Manage members
          </Link>
        )}
      </p>
      {tab === 'members' && canEdit ? (
        <>
          <Link href={base} className="mb-4 inline-block text-accent underline underline-offset-4">
            Back to the feed
          </Link>
          <GroupMembers
            groupId={detail.id}
            clients={clients}
            members={detail.members.map((m) => m.clientId)}
          />
        </>
      ) : (
        <GroupView detail={detail} tab={tab === 'chat' ? 'chat' : 'feed'} basePath={base} />
      )}
    </>
  );
}
