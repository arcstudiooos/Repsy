import { prisma } from '@kinetic/db';
import { Avatar } from '@/components/ui/avatar';
import { getServerSession, withServerTenant } from '@/server/serverActor';

/**
 * Who is signed in, and to which workspace: the sidebar footer. Reads the session, so render it in Suspense.
 * The user row is the signed-in user's own (no tenant data); the workspace name is read inside the tenant.
 */
export async function CoachIdentity() {
  const { user } = await getServerSession();
  if (!user) return null;
  const [me, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }).catch(() => null),
    withServerTenant((tx, actor) =>
      tx.organization.findFirst({ where: { id: actor.orgId }, select: { name: true } }),
    ).catch(() => null),
  ]);
  const name = me?.name?.trim() || user.email;
  return (
    <div className="flex min-w-0 items-center gap-3 px-2">
      <Avatar name={name} size="sm" />
      <div className="min-w-0 text-sm leading-tight">
        <p className="truncate font-medium text-ink">{name}</p>
        {org?.name && <p className="truncate text-secondary">{org.name}</p>}
      </div>
    </div>
  );
}

/** Just the workspace name, for the mobile header. */
export async function CoachWorkspaceName() {
  const org = await withServerTenant((tx, actor) =>
    tx.organization.findFirst({ where: { id: actor.orgId }, select: { name: true } }),
  ).catch(() => null);
  return org?.name ? <span className="truncate text-sm text-secondary">{org.name}</span> : null;
}
