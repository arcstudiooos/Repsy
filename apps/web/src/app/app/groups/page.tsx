import type { Metadata } from 'next';
import Link from 'next/link';
import { listGroups, TRAINER_ROLES } from '@kinetic/core';
import { NewGroupForm } from '@/components/groups/GroupForms';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Groups | Repsy' };

/** PRD H7, H8: cohorts and teams with a chat and a feed that you moderate. */
export default async function GroupsPage() {
  const { groups, canEdit } = await withServerTenant(async (tx, actor) => ({
    groups: await listGroups(tx, actor),
    canEdit: (TRAINER_ROLES as readonly string[]).includes(actor.role),
  }));
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Groups</h1>
      <div className="flex flex-col gap-6">
        {groups.length === 0 ? (
          <p className="text-secondary">
            No groups yet. A group gives a cohort or team its own chat and feed.
          </p>
        ) : (
          <ul aria-label="Groups" className="flex flex-col gap-2">
            {groups.map((g) => (
              <li key={g.id} className="rounded-card bg-surface p-4 shadow-card">
                <Link
                  href={`/app/groups/${g.id}`}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  {g.name}
                </Link>
                <p className="text-sm text-secondary">
                  {g.members} {g.members === 1 ? 'member' : 'members'}
                  {g.openReports > 0 && (
                    <span className="font-medium text-danger"> · {g.openReports} reported</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">New group</CardTitle>
            </CardHeader>
            <CardContent>
              <NewGroupForm />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
