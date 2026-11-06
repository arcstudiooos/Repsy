import type { Metadata } from 'next';
import { connection } from 'next/server';
import { listClasses } from '@kinetic/core';
import { PortalClasses } from '@/components/classes/PortalClasses';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Classes | Repsy' };

const DAY = 86_400_000;

/** PRD K12: the client's view of upcoming group classes, to book or join the waitlist. */
export default async function PortalClassesPage() {
  await connection();
  const now = new Date();
  const classes = await withPortalTenant((tx, actor) =>
    listClasses(tx, actor, { from: now, to: new Date(now.getTime() + 28 * DAY) }),
  );
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Classes</h1>
      <PortalClasses classes={classes} />
    </>
  );
}
