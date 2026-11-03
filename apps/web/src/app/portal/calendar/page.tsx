import type { Metadata } from 'next';
import { getClientCalendar } from '@kinetic/core';
import { CalendarMonth } from '@/components/calendar/CalendarMonth';
import { withPortalTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Calendar | Kinetic' };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The client's own month of workouts and check-ins (PRD C16), read-only. */
export default async function PortalCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).month;
  const month = typeof raw === 'string' && MONTH.test(raw) ? raw : undefined;
  const calendar = await withPortalTenant((tx, actor) => getClientCalendar(tx, actor, { month }));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Calendar</h1>
      <CalendarMonth
        calendar={calendar}
        basePath="/portal/calendar"
        workoutHref="/portal/workouts/"
        checkinHref="/portal/check-ins/"
      />
    </>
  );
}
