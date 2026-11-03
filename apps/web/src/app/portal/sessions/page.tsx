import type { Metadata } from 'next';
import { creditBalance, listBookings, listSessionTypes } from '@kinetic/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDay } from '@/lib/billing-format';
import { BOOKING_STATUS_LABEL, formatWhen } from '@/lib/schedule-format';
import { BookSession } from '@/portal/sessions/BookSession';
import { CancelBooking } from '@/portal/sessions/CancelBooking';
import { withPortalTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Sessions | Repsy' };

/** PRD K10, K11, H15: book a session with your coach, see what's booked, join the call, check your credits. */
export default async function PortalSessionsPage() {
  const data = await withPortalTenant(async (tx, actor) => ({
    timezone:
      (await tx.client.findFirst({ where: { id: actor.clientId! }, select: { timezone: true } }))
        ?.timezone ?? 'UTC',
    types: await listSessionTypes(tx, actor),
    bookings: await listBookings(tx, actor, { includeCanceled: true }),
    credits: await creditBalance(tx, actor),
  }));
  const tz = data.timezone;
  const booked = data.bookings.filter((b) => b.status === 'booked');
  const past = data.bookings
    .filter((b) => b.status !== 'booked')
    .slice(-10)
    .reverse();
  const usesCredits = data.types.some((t) => t.usesCredit);
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Sessions</h1>
      <div className="flex flex-col gap-6">
        {(usesCredits || data.credits.left > 0) && (
          <p className="rounded-card bg-surface p-4 shadow-card">
            <strong>
              {data.credits.left} session {data.credits.left === 1 ? 'credit' : 'credits'} left
            </strong>
            {data.credits.nextExpiry && ` · use by ${formatDay(data.credits.nextExpiry)}`}
          </p>
        )}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Booked</CardTitle>
          </CardHeader>
          <CardContent>
            {booked.length === 0 ? (
              <p className="text-secondary">Nothing booked.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-divider">
                {booked.map((b) => (
                  <li key={b.id} className="flex flex-col gap-2 py-3">
                    <p className="font-semibold break-words">
                      {b.title} · {formatWhen(b.startsAt, tz)}
                    </p>
                    <p className="text-sm text-secondary break-words">
                      With {b.coachName}
                      {b.location && ` · ${b.location}`}
                    </p>
                    {b.callLink && (
                      <a
                        href={b.callLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline underline-offset-4"
                      >
                        Join the call
                      </a>
                    )}
                    {b.cancellable ? (
                      <CancelBooking id={b.id} />
                    ) : (
                      <p className="text-sm text-secondary">
                        Too close to cancel here. Message your coach if you can&apos;t make it.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Book a session</CardTitle>
            <CardDescription>Pick a time that suits you.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.types.length === 0 ? (
              <p className="text-secondary">
                Your coach hasn&apos;t opened any sessions to book yet.
              </p>
            ) : (
              <BookSession types={data.types} timeZone={tz} />
            )}
          </CardContent>
        </Card>
        {past.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">Earlier</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                {past.map((b) => (
                  <li key={b.id}>
                    {b.title} · {formatWhen(b.startsAt, tz)} · {BOOKING_STATUS_LABEL[b.status]}
                    {b.creditReturned && ' · credit returned'}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
