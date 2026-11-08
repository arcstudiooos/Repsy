import type { Metadata } from 'next';
import Link from 'next/link';
import { listLeads } from '@repsy/core';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { withServerTenant } from '@/server/serverActor';
import { LeadBoard } from './LeadBoard';

export const metadata: Metadata = { title: 'Leads | Repsy' };

/** PRD B16: applications from the public page, worked from New to Won or Lost. */
export default async function LeadsPage() {
  const leads = await withServerTenant((tx, actor) => listLeads(tx, actor));
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Leads</h1>
      {leads.length === 0 ? (
        <EmptyState
          title="No leads yet"
          body="Turn on your public page in Settings and share its address. Applications show up here."
          action={
            <Link href="/settings" className={buttonVariants({ variant: 'secondary' })}>
              Settings
            </Link>
          }
        />
      ) : (
        <LeadBoard leads={leads} />
      )}
    </>
  );
}
