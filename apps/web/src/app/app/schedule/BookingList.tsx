'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { BookingView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { send } from '@/lib/billing-api';
import { BOOKING_STATUS_LABEL, formatWhen } from '@/lib/schedule-format';
import { CancelBooking } from '@/portal/sessions/CancelBooking';

/** The coach's sessions: cancel upcoming ones (any time), mark past ones done or missed. */
export function BookingList({
  bookings,
  timezone,
  nowIso,
}: {
  bookings: BookingView[];
  timezone: string;
  nowIso: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function mark(id: string, outcome: 'completed' | 'no_show') {
    setBusy(id);
    const res = await send('POST', `/api/v1/bookings/${id}/outcome`, { outcome });
    setBusy(null);
    if (res.ok) router.refresh();
    else toast.error(res.message);
  }
  if (bookings.length === 0) return <p className="text-secondary">No sessions booked.</p>;
  return (
    <ul className="flex flex-col divide-y divide-divider">
      {bookings.map((b) => {
        const started = b.startsAt <= nowIso;
        return (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold break-words">
                {formatWhen(b.startsAt, timezone)} · {b.clientName}
              </p>
              <p className="text-sm text-secondary break-words">
                {b.title} · {b.coachName}
                {b.status !== 'booked' && ` · ${BOOKING_STATUS_LABEL[b.status]}`}
                {b.usedCredit && (b.creditReturned ? ' · credit returned' : ' · 1 credit')}
              </p>
            </div>
            {b.status === 'booked' &&
              (started ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === b.id}
                    onClick={() => void mark(b.id, 'completed')}
                  >
                    Done
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === b.id}
                    onClick={() => void mark(b.id, 'no_show')}
                  >
                    Missed
                  </Button>
                </div>
              ) : (
                <CancelBooking id={b.id} />
              ))}
          </li>
        );
      })}
    </ul>
  );
}
