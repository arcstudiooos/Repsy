import Link from 'next/link';
import { prisma } from '@repsy/db';
import { Avatar } from '@/components/ui/avatar';
import { getServerSession } from '@/server/serverActor';

/** The signed-in client's avatar in the portal top bar; opens Profile. Reads the session: render in Suspense. */
export async function PortalAvatar() {
  const { user } = await getServerSession();
  if (!user) return null;
  const me = await prisma.user
    .findUnique({ where: { id: user.id }, select: { name: true } })
    .catch(() => null);
  const name = me?.name?.trim() || user.email;
  return (
    <Link
      href="/portal/profile"
      title="Your profile"
      className="hidden rounded-full md:inline-flex"
    >
      <Avatar name={name} size="sm" />
      <span className="sr-only">Your profile</span>
    </Link>
  );
}
