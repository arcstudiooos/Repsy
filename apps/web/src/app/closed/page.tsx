import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { listMyExports } from '@kinetic/core';
import { withTenant } from '@kinetic/db';
import { AuthShell } from '@/components/auth-ui';
import { DataExportSection } from '@/components/settings/DataExportSection';
import { LoadingState } from '@/components/states/LoadingState';
import { getServerActor } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Workspace closed | Kinetic' };

/**
 * PRD M12 (D-013 #16): after a lapsed workspace's read window, members land here. Exports they prepared earlier
 * can still be downloaded (the export routes stay open for that; final review #2).
 */
async function PreparedExports() {
  const actor = await getServerActor();
  const exports = await withTenant(actor.orgId, (tx) => listMyExports(tx, actor), undefined, {
    userId: actor.userId,
  });
  const ready = exports.filter((e) => e.status === 'done');
  if (ready.length === 0) return null;
  return (
    <DataExportSection
      scope={actor.role === 'client' ? 'client_self' : 'org'}
      initial={ready}
      canRequest={false}
    />
  );
}

export default function ClosedPage() {
  return (
    <AuthShell title="This workspace has closed">
      <div className="flex flex-col gap-4 text-base">
        <p>
          Its subscription lapsed and the time to read it has passed. An export you prepared before
          can still be downloaded below while its files are kept.
        </p>
        <Suspense fallback={<LoadingState />}>
          <PreparedExports />
        </Suspense>
        <p>
          Coached in another workspace?{' '}
          <Link href="/select-org" className="text-accent underline">
            Switch workspace
          </Link>
          . Questions? Ask the workspace owner.
        </p>
      </div>
    </AuthShell>
  );
}
