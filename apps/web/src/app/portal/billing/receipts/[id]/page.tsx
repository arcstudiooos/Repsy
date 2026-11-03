import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DomainError, getReceipt } from '@kinetic/core';
import { Receipt } from '@/components/billing/Receipt';
import { withPortalTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Receipt | Kinetic' };

/** PRD K6: the client's own receipt (another client's id is not found). */
export default async function PortalReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await withPortalTenant((tx, actor) => getReceipt(tx, actor, id)).catch(
    (error: unknown) => {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
      throw error;
    },
  );
  return <Receipt r={r} />;
}
