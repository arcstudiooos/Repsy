import { ArrowLeftRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { getServerSession } from '@/server/serverActor';
import { canSwitchWorkspace } from '@/server/shellGate';

/**
 * "Switch workspace" entry for users with two or more organizations (I4). Opens /select-org, which sets the active
 * org via POST /api/v1/org/switch and lands on `/` (routed by role). Renders nothing otherwise.
 * Reads the session, so render it inside a Suspense boundary.
 */
export async function WorkspaceSwitchLink({ className }: { className?: string }) {
  const { user, memberships } = await getServerSession();
  if (!user || !canSwitchWorkspace(memberships)) return null;
  return (
    <Link
      href="/select-org"
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-control px-3 text-base text-secondary transition-colors duration-[var(--k-motion-fast)] hover:bg-canvas hover:text-ink',
        className,
      )}
    >
      <ArrowLeftRight aria-hidden className="size-5" />
      Switch workspace
    </Link>
  );
}
