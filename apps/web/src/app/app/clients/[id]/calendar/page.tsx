import type { Metadata } from 'next';
import { DomainError, getClientCalendar } from '@kinetic/core';
import { CalendarMonth } from '@/components/calendar/CalendarMonth';
import { ErrorState } from '@/components/states/ErrorState';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

export const metadata: Metadata = { title: 'Calendar | Repsy' };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A month of the client's workouts and check-ins; the coach moves unstarted workouts here (PRD C16). */
export default async function ClientCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const client = await loadClient((await params).id);
  const raw = (await searchParams).month;
  const month = typeof raw === 'string' && MONTH.test(raw) ? raw : undefined;
  let calendar;
  try {
    calendar = await withServerTenant((tx, actor) =>
      getClientCalendar(tx, actor, { clientId: client.id, month }),
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === 'VALIDATION') {
      return <ErrorState message="That month is not valid." />;
    }
    throw error;
  }
  const base = `/app/clients/${client.id}`;
  return (
    <CalendarMonth
      calendar={calendar}
      basePath={`${base}/calendar`}
      workoutHref={`${base}/sessions/`}
      checkinHref={`${base}/check-ins`}
    />
  );
}
