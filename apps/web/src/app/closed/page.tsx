import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth-ui';

export const metadata: Metadata = { title: 'Workspace closed | Kinetic' };

/** PRD M12 (D-013 #16): after a lapsed workspace's read window, members land here. */
export default function ClosedPage() {
  return (
    <AuthShell title="This workspace has closed">
      <div className="flex flex-col gap-3 text-base">
        <p>
          Its subscription lapsed and the time to read it has passed. If you prepared an export, the
          download link in its email still works until it expires.
        </p>
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
