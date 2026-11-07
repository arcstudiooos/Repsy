import type { Metadata } from 'next';
// NOTE (slice merge): the parent adds these names to '@kinetic/core' first
// (see SLICE_REPORT_SCHEDULING.md); the page then compiles unchanged.
import {
  getCalendarConnection,
  googleOAuthConfig,
  listSessionTypes,
  TRAINER_ROLES,
} from '@kinetic/core';
import { CalendarConnectCard } from '@/components/scheduling/CalendarConnectCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BookSessionForm,
  ClientSchedulingLookup,
  NewSessionTypeForm,
} from '@/components/scheduling/SchedulingForms';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Scheduling | Repsy' };

/** PRD K10, K11, H15: availability, bookings with call links, pack balances. */
export default async function SchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const { calendar } = await searchParams;
  const { types, canEdit, connection } = await withServerTenant(async (tx, actor) => {
    const canEdit = (TRAINER_ROLES as readonly string[]).includes(actor.role);
    return {
      types: await listSessionTypes(tx, actor),
      canEdit,
      connection: canEdit ? await getCalendarConnection(tx, actor) : null,
    };
  });
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Scheduling</h1>
      <div className="flex flex-col gap-6">
        {canEdit && (
          <CalendarConnectCard
            connection={connection}
            available={googleOAuthConfig() !== null}
            notice={calendar}
          />
        )}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Session types</CardTitle>
          </CardHeader>
          <CardContent>
            {types.length === 0 ? (
              <p className="text-secondary">No session types yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {types.map((t) => (
                  <li key={t.id}>
                    {t.name} — {t.kind.replace('_', ' ')}, {t.durationMinutes} minutes
                    {t.bufferBeforeMinutes > 0 || t.bufferAfterMinutes > 0
                      ? `, buffers ${t.bufferBeforeMinutes}/${t.bufferAfterMinutes} min`
                      : ''}
                    {t.location ? `, at ${t.location}` : ''}
                    {': '}
                    {t.availability
                      .map(
                        (w) =>
                          `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][w.weekday - 1]} ${w.startTime}–${w.endTime}`,
                      )
                      .join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">New session type</CardTitle>
            </CardHeader>
            <CardContent>
              <NewSessionTypeForm />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle as="h2">Book a session</CardTitle>
          </CardHeader>
          <CardContent>
            {types.length === 0 ? (
              <p className="text-secondary">Create a session type first.</p>
            ) : (
              <BookSessionForm sessionTypes={types.map((t) => ({ id: t.id, name: t.name }))} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">A client&apos;s bookings and packs</CardTitle>
          </CardHeader>
          <CardContent>
            <ClientSchedulingLookup />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
