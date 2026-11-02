import type { ReceiptView } from '@kinetic/core';
import { formatMoney, receiptLabel } from '@kinetic/core/money';
import { METHOD_LABEL, PAYMENT_STATUS_LABEL, formatDay } from '@/lib/billing-format';
import { PrintButton } from './PrintButton';

/** PRD K6: a branded, printable receipt. Tax shown is included in the amount (D-013 #6). */
export function Receipt({ r }: { r: ReceiptView }) {
  return (
    <article
      aria-labelledby="receipt-heading"
      className="mx-auto flex max-w-xl flex-col gap-4 rounded-card bg-surface p-6 shadow-card print:shadow-none"
      style={r.brandAccent ? { borderTop: `6px solid ${r.brandAccent}` } : undefined}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {r.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.logoUrl} alt="" className="mb-2 h-10 w-auto" />
          )}
          <p className="text-lg font-semibold">{r.orgName}</p>
          {r.taxId && <p className="text-sm text-secondary">Tax number {r.taxId}</p>}
        </div>
        <div className="text-right">
          <h1 id="receipt-heading" className="text-xl font-semibold">
            Receipt {receiptLabel(r.receiptNo)}
          </h1>
          <p className="text-sm text-secondary">{formatDay(r.paidAt)}</p>
        </div>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-secondary">Billed to</dt>
        <dd className="break-words">
          {r.clientName}
          <span className="block text-sm text-secondary">{r.clientEmail}</span>
        </dd>
        <dt className="text-secondary">For</dt>
        <dd className="break-words">{r.packageTitle}</dd>
        <dt className="text-secondary">Paid by</dt>
        <dd>{METHOD_LABEL[r.method] ?? r.method}</dd>
        <dt className="text-secondary">Status</dt>
        <dd>{PAYMENT_STATUS_LABEL[r.status] ?? r.status}</dd>
      </dl>
      <table className="w-full text-left">
        <tbody className="divide-y divide-divider">
          {r.taxLines.map((t) => (
            <tr key={t.label}>
              <th scope="row" className="py-1 font-normal text-secondary">
                {t.label}
              </th>
              <td className="py-1 text-right">{formatMoney(t.amountMinor, r.currency)}</td>
            </tr>
          ))}
          {r.refundedMinor > 0 && (
            <tr>
              <th scope="row" className="py-1 font-normal text-secondary">
                Refunded
              </th>
              <td className="py-1 text-right">-{formatMoney(r.refundedMinor, r.currency)}</td>
            </tr>
          )}
          <tr>
            <th scope="row" className="py-2 font-semibold">
              Total paid
            </th>
            <td className="py-2 text-right text-lg font-semibold">
              {formatMoney(r.amountMinor, r.currency)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="print:hidden">
        <PrintButton />
      </div>
    </article>
  );
}
