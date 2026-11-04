import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { withSystem } from '@kinetic/db';
import { AuthShell } from '@/components/auth-ui';
import { LoadingState } from '@/components/states/LoadingState';
import { getSessionUser } from '@/lib/auth';
import { loadMemberships } from '@/server/actor';
import { OrgChoices } from './OrgChoices';

export const metadata: Metadata = { title: 'Choose workspace | Repsy' };

/** Lists the signed-in user's workspaces; choosing one POSTs to /api/v1/org/switch. */
async function Choices() {
  const user = await getSessionUser(await headers());
  if (!user) redirect('/login?next=%2Fselect-org');
  const memberships = await loadMemberships(user.id);
  if (memberships.length === 0) redirect('/');

  const orgIds = [...new Set(memberships.map((m) => m.orgId))];
  const orgs = await withSystem((tx) =>
    tx.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  );
  const choices = orgs.map((o) => ({
    orgId: o.id,
    name: o.name,
    roles: memberships.filter((m) => m.orgId === o.id).map((m) => m.role),
  }));
  return (
    <AuthShell title="Choose a workspace">
      <OrgChoices choices={choices} />
    </AuthShell>
  );
}

export default function SelectOrgPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Choices />
    </Suspense>
  );
}
