import type { Metadata } from 'next';
import {
  can,
  getCalendarConnection,
  getSchedule,
  listBookings,
  listClients,
  listSessionTypes,
} from '@kinetic/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { availableCalendars } from '@/server/routes/scheduling';
import { withServerTenant } from '@/server/serverActor';
import { BookingList } from './BookingList';
import { BookForClient } from './BookForClient';
import { CalendarCard } from './CalendarCard';
import { SessionTypes } from './SessionTypes';
import { TimeOff } from './TimeOff';
import { WeeklyHours } from './WeeklyHours';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Schedule | Repsy' };

const DAY = 86_400_000;
/** The list window, read per request (a server component, so there is no re-render to keep stable). */
const listWindow = () => {
  const now = Date.now();
  return { now: new Date(now), from: new Date(now - 7 * DAY), to: new Date(now + 60 * DAY) };
};

/** PRD K10, K11, H15 (D-013 #11): sessions clients book, hours, time off, calendar sync and booked sessions. */
export default async function SchedulePage() {
  const data = await withServerTenant(async (tx, actor) => {
    // Read the clock after the session lookup, so the page is rendered per request.
    const w = listWindow();
    const manage = can(actor, 'schedule:manage');
    return {
      nowIso: w.now.toISOString(),
      manage,
      schedule: await getSchedule(tx, actor, undefined, w.now),
      types: await listSessionTypes(tx, actor, {
        ...(manage ? { coachUserId: actor.userId } : {}),
        includeInactive: true,
      }),
      bookings: await listBookings(
        tx,
        actor,
        { from: w.from, to: w.to, ...(manage ? { coachUserId: actor.userId } : {}) },
        w.now,
      ),
      calendar: manage ? await getCalendarConnection(tx, actor) : null,
      clients: manage
        ? (await listClients(tx, actor, { status: 'active' })).items.map((c) => ({
            id: c.id,
            name: c.name,
          }))
        : [],
    };
  });
  const tz = data.schedule.timezone;
  const bookable = data.types.filter((t) => t.active);
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold md:text-3xl">Schedule</h1>
      <p className="mb-6 text-secondary">Times here are in {tz.replace(/_/g, ' ')}.</p>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Sessions</CardTitle>
            <CardDescription>The last week and the next two months.</CardDescription>
          </CardHeader>
          <CardContent>
            <BookingList bookings={data.bookings} timezone={tz} nowIso={data.nowIso} />
          </CardContent>
        </Card>
        {data.manage && (
          <>
            {bookable.length > 0 && data.clients.length > 0 && (
              <BookForClient clients={data.clients} types={bookable} timeZone={tz} />
            )}
            <SessionTypes types={data.types} />
            <WeeklyHours timezone={tz} windows={data.schedule.windows} />
            <TimeOff items={data.schedule.timeOff} timezone={tz} />
            <CalendarCard connection={data.calendar} providers={availableCalendars()} />
          </>
        )}
      </div>
    </>
  );
}
