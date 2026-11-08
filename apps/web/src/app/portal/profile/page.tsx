import type { Metadata } from 'next';
import Link from 'next/link';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { ConsistencyHeatmap } from '@/components/charts/ConsistencyHeatmap';
import { BarChart, LineChart } from '@/components/charts/Interactive';
import { STATE_COLOR, STATE_LABEL } from '@/components/charts/palette';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { Section } from '@/components/ui/section';
import { dayMonth } from '@/lib/relative-time';
import {
  deletionStatusFor,
  getSettings,
  hasCalendarFeed,
  listMyExports,
  twoFactorStatus,
  getClientConsistency,
  getExerciseProgress,
  getPersonalRecords,
  getWeeklyVolume,
  toDisplay,
} from '@repsy/core';
import { DeletionRequestButton } from '@/components/settings/DeletionRequestButton';
import { DataExportSection } from '@/components/settings/DataExportSection';
import { ClientPreferencesSection } from '@/components/settings/ClientSections';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { TwoFactorSection } from '@/components/settings/TwoFactorSection';
import { SignOutButton } from '@/components/nav/SignOutButton';
import { CalendarLink } from '@/portal/CalendarLink';
import { PushToggle } from '@/portal/PushToggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withPortalTenant } from '@/server/serverActor';
import { connection } from 'next/server';
import { LegalLinks } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Profile | Repsy' };

// Access is enforced by src/proxy.ts and the portal layout's client gate.
/** Read per request (a server component renders once per request). */
const requestNow = () => new Date();

export default async function PortalProfile() {
  // The clock is request data: render per request, never at build time.
  await connection();
  const now = requestNow();
  const { settings, exports, deletion, twoFactor, calendar, progress } = await withPortalTenant(
    async (tx, actor) => ({
      settings: await getSettings(tx, actor),
      exports: await listMyExports(tx, actor),
      deletion: await deletionStatusFor(tx, actor),
      twoFactor: await twoFactorStatus(tx, actor),
      calendar: await hasCalendarFeed(tx, actor),
      // "My progress" (plan §8.6): the client's own consistency, volume and top lift. In-app only.
      progress: await (async () => {
        const id = actor.clientId as string;
        const units =
          (await tx.client.findFirst({ where: { id }, select: { preferredUnits: true } }))
            ?.preferredUnits ?? 'kg';
        const top = (await getPersonalRecords(tx, actor, id))
          .filter((r) => r.trackingType === 'reps_load')
          .sort((a, b) => b.sessions - a.sessions)[0];
        return {
          units: units as 'kg' | 'lb',
          consistency: await getClientConsistency(tx, actor, id, { weeks: 12, now }),
          volume: await getWeeklyVolume(tx, actor, id, { now }),
          lift: top ? await getExerciseProgress(tx, actor, id, top.exerciseId) : null,
        };
      })(),
    }),
  );
  const u = progress.units;
  const conv = (kg: number) => Math.round(toDisplay(kg, u) * 10) / 10;
  const doneDays = progress.consistency.filter((c) => c.state === 'completed').length;
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold">Profile</h1>
      <div className="flex flex-col gap-6">
        <Section title="My progress" description="Only you and your coach see this.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <ChartFrame
                title="Consistency, last 12 weeks"
                summary={`You completed workouts on ${doneDays} days in the last 12 weeks.`}
                legend={[
                  { label: STATE_LABEL.completed, color: STATE_COLOR.completed },
                  { label: STATE_LABEL.skipped, color: STATE_COLOR.skipped },
                  { label: STATE_LABEL.missed, color: STATE_COLOR.missed },
                ]}
              >
                <ConsistencyHeatmap
                  cells={progress.consistency.map((c) => ({ date: c.localDate, state: c.state }))}
                />
              </ChartFrame>
            </Card>
            <Card>
              <ChartFrame
                title="Weekly volume"
                summary={`Weekly volume (load × reps), ${u}: ${progress.volume.map((w) => `${dayMonth(w.weekStart)} ${Math.round(toDisplay(w.volumeKg, u))}`).join(', ')}.`}
                table={{
                  columns: ['Week', `Volume (${u})`, 'Workouts'],
                  rows: progress.volume.map((w) => [
                    dayMonth(w.weekStart),
                    Math.round(toDisplay(w.volumeKg, u)),
                    w.sessions,
                  ]),
                }}
              >
                <BarChart
                  height={160}
                  data={progress.volume.map((w) => ({
                    week: dayMonth(w.weekStart),
                    volume: Math.round(toDisplay(w.volumeKg, u)),
                  }))}
                  x="week"
                  unit={u}
                  series={[{ key: 'volume', label: 'Volume' }]}
                />
              </ChartFrame>
            </Card>
            {progress.lift && progress.lift.points.length > 1 && (
              <Card className="lg:col-span-2">
                <ChartFrame
                  title={`Strength: ${progress.lift.name}`}
                  summary={`${progress.lift.name}: ${progress.lift.points.length} sessions, ${progress.lift.points.filter((p) => p.isPersonalRecord).length} personal records.`}
                  legend={[
                    { label: 'Top set', color: 'var(--k-chart-1)' },
                    { label: 'Estimated 1RM', color: 'var(--k-chart-2)', dashed: true },
                  ]}
                  table={{
                    columns: ['Date', `Top set (${u})`, `Estimated 1RM (${u})`],
                    rows: progress.lift.points.map((p) => [
                      dayMonth(p.localDate),
                      p.topSetKg === null ? '–' : conv(p.topSetKg),
                      p.estimatedOneRepMaxKg === null ? '–' : conv(p.estimatedOneRepMaxKg),
                    ]),
                  }}
                >
                  <LineChart
                    data={progress.lift.points.map((p) => ({
                      date: dayMonth(p.localDate),
                      top: p.topSetKg === null ? null : conv(p.topSetKg),
                      e1rm: p.estimatedOneRepMaxKg === null ? null : conv(p.estimatedOneRepMaxKg),
                    }))}
                    x="date"
                    unit={u}
                    series={[
                      { key: 'top', label: 'Top set' },
                      { key: 'e1rm', label: 'Estimated 1RM', dashed: true },
                    ]}
                    markers={progress.lift.points
                      .filter((p) => p.isPersonalRecord)
                      .map((p) => ({ x: dayMonth(p.localDate), key: 'e1rm' }))}
                  />
                </ChartFrame>
              </Card>
            )}
          </div>
        </Section>
        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
          </CardHeader>
          <CardContent>
            <ThemeToggle />
          </CardContent>
        </Card>
        {settings.client && <ClientPreferencesSection client={settings.client} />}
        <NotificationsSection notifications={settings.notifications} />
        <PushToggle />
        <CalendarLink active={calendar} />
        <DataExportSection scope="client_self" initial={exports}>
          <DeletionRequestButton current={deletion} />
        </DataExportSection>
        <TwoFactorSection enabled={twoFactor.enabled} required={false} />
        <SecuritySection />
        <p className="text-secondary">
          Your plan and receipts:{' '}
          <Link href="/portal/billing" className="text-accent underline">
            My billing
          </Link>
        </p>
        <p className="text-secondary">
          Need help?{' '}
          <Link href="/portal/support" className="text-accent underline">
            Help and support
          </Link>
        </p>
        <LegalLinks className="text-sm text-secondary" />
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <SignOutButton
              className="border border-input-border px-4 text-ink"
              redirectTo="/login"
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
