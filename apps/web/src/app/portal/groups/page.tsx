import type { Metadata } from 'next';
import Link from 'next/link';
import { listGroups } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Groups | Kinetic' };

/** PRD H7, H8: the groups the client is in. */
export default async function PortalGroupsPage() {
  const groups = await withPortalTenant((tx, actor) => listGroups(tx, actor));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Groups</h1>
      {groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          body="When your coach adds you to a group, it shows here."
        />
      ) : (
        <ul aria-label="Groups" className="flex flex-col gap-2">
          {groups.map((g) => (
            <li key={g.id} className="rounded-card bg-surface p-4 shadow-card">
              <Link
                href={`/portal/groups/${g.id}`}
                className="font-semibold underline-offset-4 hover:underline"
              >
                {g.name}
              </Link>
              <p className="text-sm text-secondary">
                {g.members} {g.members === 1 ? 'member' : 'members'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
