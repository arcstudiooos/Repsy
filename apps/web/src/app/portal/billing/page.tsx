import type { Metadata } from 'next';
import { BillingSelfService } from '@/portal/BillingSelfService';

export const metadata: Metadata = { title: 'My billing | Repsy' };

/** PRD K8: the client's billing self-service page. */
export default function PortalBillingPage() {
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">My billing</h1>
      <BillingSelfService />
    </>
  );
}
