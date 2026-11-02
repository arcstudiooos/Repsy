import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DomainError, getReceipt } from '@kinetic/core';
import { Receipt } from '@/components/billing/Receipt';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Receipt | Kinetic' };

export default async function CoachReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await withServerTenant((tx, actor) => getReceipt(tx, actor, id)).catch(
    (error: unknown) => {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
      throw error;
    },
  );
  return <Receipt r={r} />;
}
