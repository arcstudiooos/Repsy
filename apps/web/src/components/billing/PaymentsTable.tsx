import Link from 'next/link';
import type { PaymentView } from '@kinetic/core';
import { formatMoney, receiptLabel } from '@kinetic/core/money';
import { METHOD_LABEL, PAYMENT_STATUS_LABEL, formatDay } from '@/lib/billing-format';

/** Payments, newest first, with receipt links. `receiptBase` is where receipts open. */
export function PaymentsTable({
  payments,
  showClient = true,
  receiptBase = '/app/billing/receipts',
}: {
  payments: PaymentView[];
  showClient?: boolean;
  receiptBase?: string;
}) {
  if (payments.length === 0) return <p className="text-secondary">No payments yet.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Payments">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="text-secondary">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Date
            </th>
            {showClient && (
              <th scope="col" className="py-2 pr-3 font-medium">
                Client
              </th>
            )}
            <th scope="col" className="py-2 pr-3 font-medium">
              Package
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Amount
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Status
            </th>
            <th scope="col" className="py-2 font-medium">
              Receipt
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {payments.map((p) => (
            <tr key={p.id}>
              <td className="py-2 pr-3">{formatDay(p.paidAt)}</td>
              {showClient && <td className="py-2 pr-3 break-words">{p.clientName}</td>}
              <td className="py-2 pr-3 break-words">{p.packageTitle}</td>
              <td className="py-2 pr-3">
                {formatMoney(p.amountMinor, p.currency)}
                {p.refundedMinor > 0 && p.status !== 'refunded' && (
                  <span className="block text-secondary">
                    {formatMoney(p.refundedMinor, p.currency)} refunded
                  </span>
                )}
                <span className="block text-secondary">{METHOD_LABEL[p.method] ?? p.method}</span>
              </td>
              <td className="py-2 pr-3">{PAYMENT_STATUS_LABEL[p.status] ?? p.status}</td>
              <td className="py-2">
                {p.receiptNo !== null ? (
                  <Link
                    href={`${receiptBase}/${p.id}`}
                    className="text-accent underline underline-offset-4"
                  >
                    {receiptLabel(p.receiptNo)}
                  </Link>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
