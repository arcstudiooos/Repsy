import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { isManager, listClasses, listLocations, TRAINER_ROLES } from '@kinetic/core';
import { ClassesBoard } from '@/components/classes/ClassesBoard';
import { buttonVariants } from '@/components/ui/button';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Classes | Repsy' };

const DAY = 86_400_000;

/** PRD K12: group classes for the next four weeks, with capacity, waitlist and attendance. */
export default async function ClassesPage() {
  await connection();
  const now = new Date();
  const { classes, locations, coaches, canManage, manager } = await withServerTenant(
    async (tx, actor) => ({
      classes: await listClasses(tx, actor, {
        from: new Date(now.getTime() - DAY),
        to: new Date(now.getTime() + 28 * DAY),
      }),
      locations: (await listLocations(tx, actor)).map((l) => ({ id: l.id, name: l.name })),
      coaches: (
        await tx.membership.findMany({
          where: { status: 'active', role: { in: [...TRAINER_ROLES] } },
          orderBy: { createdAt: 'asc' },
          select: { userId: true, user: { select: { name: true } } },
        })
      ).map((m) => ({ id: m.userId, name: m.user.name ?? 'Coach' })),
      canManage: (TRAINER_ROLES as readonly string[]).includes(actor.role),
      manager: isManager(actor.role),
    }),
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold md:text-display">Classes</h1>
        {manager && (
          <Link href="/app/locations" className={buttonVariants({ variant: 'secondary' })}>
            Locations
          </Link>
        )}
      </div>
      <ClassesBoard
        classes={classes}
        locations={locations}
        coaches={coaches}
        canManage={canManage}
        now={now.toISOString()}
      />
    </>
  );
}
