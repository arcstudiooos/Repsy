import type { Metadata } from 'next';
import {
  clientCompliance,
  COMPLIANCE_WINDOWS,
  deletionStatusFor,
  getPersonalRecords,
  getSettings,
  listGoals,
  listHabits,
  listTags,
  tagsForClients,
  getEngagement,
  acceptancesFor,
  getCheckinSeries,
  getClientAdherence,
  getClientConsistency,
  getExerciseProgress,
  getStreak,
  getWeeklyVolume,
  toDisplay,
} from '@kinetic/core';
import { CompliancePercent, WINDOW_LABEL } from '@/components/analytics/Compliance';
import { EngagementCard } from '@/components/analytics/Engagement';
import { GoalsPanel } from '@/components/goals/GoalsPanel';
import { DeletionRequestButton } from '@/components/settings/DeletionRequestButton';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { ConsistencyHeatmap } from '@/components/charts/ConsistencyHeatmap';
import { BarChart, LineChart } from '@/components/charts/Interactive';
import { STATE_COLOR, STATE_LABEL } from '@/components/charts/palette';
import { ProgressRing } from '@/components/charts/ProgressRing';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChipRow, FilterChip } from '@/components/ui/filter-chip';
import { StatTile } from '@/components/ui/stat-tile';
import { dayMonth, relativeDay } from '@/lib/relative-time';
import { withServerTenant } from '@/server/serverActor';
import { formatDate } from '../StatusBadge';
import { loadClient } from './data';
import { AgreementStatus } from './AgreementStatus';
import { InviteControls } from './InviteControls';
import { TagEditor } from './TagEditor';

export const metadata: Metadata = { title: 'Client | Repsy' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const requestNow = () => new Date();

export default async function ClientOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const client = await loadClient((await params).id);
  const sp = await searchParams;
  const now = requestNow();
  const {
    isOwner,
    deletion,
    compliance,
    allTags,
    clientTags,
    goals,
    lifts,
    habits,
    units,
    engagement,
    agreements,
    adh28,
    streak,
    consistency,
    volume,
    wellbeing,
    lastCheckin,
    strength,
  } = await withServerTenant(async (tx, actor) => ({
    isOwner: actor.role === 'owner',
    deletion: await deletionStatusFor(tx, actor, client.id),
    compliance: (await clientCompliance(tx, actor, [client.id])).get(client.id) ?? null,
    allTags: await listTags(tx, actor),
    clientTags: (await tagsForClients(tx, actor, [client.id])).get(client.id) ?? [],
    goals: await listGoals(tx, actor, client.id),
    lifts: (await getPersonalRecords(tx, actor, client.id))
      .filter((r) => r.trackingType === 'reps_load')
      .map((r) => ({ id: r.exerciseId, name: r.name })),
    habits: (await listHabits(tx, actor, client.id)).habits
      .filter((h) => h.status === 'active')
      .map((h) => ({ id: h.id, title: h.title })),
    units: (await getSettings(tx, actor)).profile?.units ?? client.preferredUnits,
    engagement: await getEngagement(tx, actor, client.id),
    agreements: await acceptancesFor(tx, client.id),
    adh28:
      (await getClientAdherence(tx, actor, [client.id], { days: 28, now })).get(client.id) ?? null,
    streak: await getStreak(tx, actor, client.id, { now }),
    consistency: await getClientConsistency(tx, actor, client.id, { weeks: 12, now }),
    volume: await getWeeklyVolume(tx, actor, client.id, { now }),
    wellbeing: await getCheckinSeries(tx, actor, client.id, { limit: 12 }).catch(() => null),
    lastCheckin: await tx.checkin.findFirst({
      where: { clientId: client.id, submittedAt: { not: null } },
      orderBy: { submittedAt: 'desc' },
      select: { submittedAt: true },
    }),
    strength: await (async () => {
      const recs = (await getPersonalRecords(tx, actor, client.id))
        .filter((r) => r.trackingType === 'reps_load')
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 6);
      const pick = recs.find((r) => r.exerciseId === first(sp.exercise)) ?? recs[0];
      if (!pick) return null;
      return {
        options: recs.map((r) => ({ id: r.exerciseId, name: r.name })),
        selected: pick.exerciseId,
        progress: await getExerciseProgress(tx, actor, client.id, pick.exerciseId),
      };
    })(),
  }));
  const joined = client.joinedAt ? client.joinedAt.slice(0, 10) : null;
  const rows: [string, string][] = [
    ['Email', client.email],
    ['Start date', formatDate(client.startDate)],
    ['Time zone', client.timezone],
    ['Units', client.preferredUnits],
  ];
  if (joined) rows.push(['Joined', formatDate(joined)]);
  return (
    <div className="flex flex-col gap-6">
      {client.status === 'invited' && client.inviteStatus !== 'accepted' && (
        <Card>
          <CardHeader>
            <CardTitle>Invitation</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteControls
              clientId={client.id}
              inviteStatus={client.inviteStatus}
              inviteExpiresAt={client.inviteExpiresAt}
            />
          </CardContent>
        </Card>
      )}
      <ul aria-label="At a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <li>
          <StatTile
            label="Adherence, 4 weeks"
            value={adh28?.adherencePct == null ? '–' : `${Math.round(adh28.adherencePct)}%`}
            hint={
              adh28
                ? `${adh28.counts.completed} of ${adh28.counts.eligible} due workouts done`
                : undefined
            }
          />
        </li>
        <li>
          <StatTile
            label="Current streak"
            value={streak}
            hint={`${streak === 1 ? 'workout' : 'workouts'} completed in a row`}
          />
        </li>
        <li>
          <StatTile
            label="Workouts completed"
            value={volume.reduce((n, w) => n + w.sessions, 0)}
            hint="Last 8 weeks"
            spark={volume.map((w) => w.sessions)}
          />
        </li>
        <li>
          <StatTile
            label="Last check-in"
            value={
              lastCheckin?.submittedAt
                ? dayMonth(lastCheckin.submittedAt.toISOString().slice(0, 10))
                : '–'
            }
            hint={
              lastCheckin?.submittedAt
                ? `Sent ${relativeDay(lastCheckin.submittedAt.toISOString(), now)}`
                : 'None sent yet'
            }
            href={`/app/clients/${client.id}/check-ins`}
          />
        </li>
      </ul>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <ChartFrame
            titleAs="h2"
            title="Consistency, last 12 weeks"
            summary={(() => {
              const c = { completed: 0, skipped: 0, missed: 0 };
              for (const x of consistency) {
                if (x.state === 'completed') c.completed++;
                else if (x.state === 'skipped') c.skipped++;
                else if (x.state === 'missed' || x.state === 'notFinished') c.missed++;
              }
              return `Over 12 weeks: ${c.completed} days completed, ${c.skipped} skipped and ${c.missed} missed or not finished.`;
            })()}
            legend={[
              { label: STATE_LABEL.completed, color: STATE_COLOR.completed },
              { label: STATE_LABEL.skipped, color: STATE_COLOR.skipped },
              { label: STATE_LABEL.notFinished, color: STATE_COLOR.notFinished },
              { label: STATE_LABEL.missed, color: STATE_COLOR.missed },
              { label: 'Still due', color: STATE_COLOR.due },
            ]}
          >
            <ConsistencyHeatmap
              cells={consistency.map((x) => ({ date: x.localDate, state: x.state }))}
            />
          </ChartFrame>
        </Card>
        <Card>
          <ChartFrame
            titleAs="h2"
            title="Training volume"
            summary={`Weekly volume (load × reps) for the last ${volume.length} weeks, ${units}: ${volume.map((w) => `${dayMonth(w.weekStart)} ${Math.round(toDisplay(w.volumeKg, units))}`).join(', ')}.`}
            table={{
              columns: ['Week', `Volume (${units})`, 'Sessions'],
              rows: volume.map((w) => [
                dayMonth(w.weekStart),
                Math.round(toDisplay(w.volumeKg, units)),
                w.sessions,
              ]),
            }}
          >
            <BarChart
              height={180}
              data={volume.map((w) => ({
                week: dayMonth(w.weekStart),
                volume: Math.round(toDisplay(w.volumeKg, units)),
              }))}
              x="week"
              unit={units}
              series={[{ key: 'volume', label: 'Volume' }]}
            />
          </ChartFrame>
        </Card>
      </div>

      <Card>
        {strength === null ? (
          <div>
            <h2 className="text-h2 font-semibold">Strength progress</h2>
            <p className="mt-1 text-sm text-secondary">
              Appears once the client logs weighted sets.
            </p>
          </div>
        ) : (
          <ChartFrame
            titleAs="h2"
            title={`Strength progress: ${strength.progress.name}`}
            summary={(() => {
              const pts = strength.progress.points.filter((p) => p.estimatedOneRepMaxKg !== null);
              if (pts.length === 0)
                return `No weighted sets logged for ${strength.progress.name} yet.`;
              const a = pts[0]!;
              const b = pts.at(-1)!;
              return `${strength.progress.name}: estimated 1RM went from ${Math.round(toDisplay(a.estimatedOneRepMaxKg!, units))} to ${Math.round(toDisplay(b.estimatedOneRepMaxKg!, units))} ${units} over ${pts.length} sessions, with ${pts.filter((p) => p.isPersonalRecord).length} personal records.`;
            })()}
            legend={[
              { label: 'Top set', color: 'var(--k-chart-1)' },
              { label: 'Estimated 1RM (Epley)', color: 'var(--k-chart-2)', dashed: true },
              { label: 'Personal record', color: 'var(--k-cyan)' },
            ]}
            table={{
              columns: ['Date', `Top set (${units})`, 'Reps', `Estimated 1RM (${units})`, 'PR'],
              rows: strength.progress.points.map((p) => [
                dayMonth(p.localDate),
                p.topSetKg === null ? '–' : Math.round(toDisplay(p.topSetKg, units) * 10) / 10,
                p.topSetReps ?? '–',
                p.estimatedOneRepMaxKg === null
                  ? '–'
                  : Math.round(toDisplay(p.estimatedOneRepMaxKg, units)),
                p.isPersonalRecord ? 'Yes' : '',
              ]),
            }}
            action={
              strength.options.length > 1 && (
                <ChipRow label="Exercise">
                  {strength.options.map((o) => (
                    <FilterChip
                      key={o.id}
                      href={`?exercise=${o.id}`}
                      active={o.id === strength.selected}
                    >
                      {o.name}
                    </FilterChip>
                  ))}
                </ChipRow>
              )
            }
          >
            <LineChart
              data={strength.progress.points.map((p) => ({
                date: dayMonth(p.localDate),
                top:
                  p.topSetKg === null ? null : Math.round(toDisplay(p.topSetKg, units) * 10) / 10,
                e1rm:
                  p.estimatedOneRepMaxKg === null
                    ? null
                    : Math.round(toDisplay(p.estimatedOneRepMaxKg, units)),
              }))}
              x="date"
              unit={units}
              series={[
                { key: 'top', label: 'Top set' },
                { key: 'e1rm', label: 'Estimated 1RM', dashed: true },
              ]}
              markers={strength.progress.points
                .filter((p) => p.isPersonalRecord)
                .map((p) => ({ x: dayMonth(p.localDate), key: 'e1rm' }))}
            />
          </ChartFrame>
        )}
      </Card>

      {wellbeing && wellbeing.questions.length > 0 && wellbeing.points.length > 0 && (
        <Card>
          <ChartFrame
            titleAs="h2"
            title="Wellbeing trend"
            summary={`1 to 5 answers from the last ${wellbeing.points.length} check-ins: ${wellbeing.questions
              .map((q) => {
                const v = wellbeing.points.at(-1)!.values[q.id];
                return `${q.label} latest ${v ?? 'not answered'}`;
              })
              .join('; ')}.`}
            legend={wellbeing.questions.map((q, i) => ({
              label: q.label,
              color: `var(--k-chart-${(i % 6) + 1})`,
            }))}
            table={{
              columns: ['Week of', ...wellbeing.questions.map((q) => q.label)],
              rows: wellbeing.points.map((p) => [
                dayMonth(p.periodLocalDate),
                ...wellbeing.questions.map((q) => p.values[q.id] ?? '–'),
              ]),
            }}
          >
            <LineChart
              height={200}
              data={wellbeing.points.map((p) => ({
                week: dayMonth(p.periodLocalDate),
                ...p.values,
              }))}
              x="week"
              series={wellbeing.questions.map((q) => ({ key: q.id, label: q.label }))}
            />
          </ChartFrame>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {compliance && (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Adherence</CardTitle>
                <CardDescription>
                  Completed of due workouts, ending today in the client&apos;s time zone. Paused and
                  cancelled workouts are left out.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-2">
                  {COMPLIANCE_WINDOWS.map((days) => {
                    const c = compliance[days];
                    return (
                      <div
                        key={days}
                        className="flex flex-col items-center gap-2 rounded-md bg-surface-2 p-3 text-center"
                      >
                        <ProgressRing
                          value={c.eligible > 0 ? (c.completed / c.eligible) * 100 : null}
                          size={80}
                          stroke={9}
                        />
                        <dt className="text-sm font-medium">Last {WINDOW_LABEL[days]}</dt>
                        <dd className="text-sm text-secondary">
                          <CompliancePercent counts={c} />
                        </dd>
                        {c.eligible > 0 && (
                          <dd className="hidden text-caption text-secondary sm:block">
                            {c.skipped} skipped · {c.incomplete} not finished · {c.missed} missed
                          </dd>
                        )}
                      </div>
                    );
                  })}
                </dl>
              </CardContent>
            </Card>
          )}
          <EngagementCard weeks={engagement} />
          <GoalsPanel
            clientId={client.id}
            goals={goals}
            units={units}
            canEdit
            exercises={lifts}
            habits={habits}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">About</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col divide-y divide-border text-sm">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                    <dt className="text-secondary">{label}</dt>
                    <dd className="text-right break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Tags</CardTitle>
              <CardDescription>
                Group clients to filter the client list. Clients never see tags.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TagEditor
                clientId={client.id}
                all={allTags.map(({ id, name, color }) => ({ id, name, color }))}
                selected={clientTags.map((t) => t.id)}
              />
            </CardContent>
          </Card>
          <AgreementStatus items={agreements} />
          {isOwner && (
            <Card>
              <CardHeader>
                <CardTitle>Data</CardTitle>
                <CardDescription>
                  Ask Repsy to delete this client&apos;s data; the request is verified first.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DeletionRequestButton clientId={client.id} current={deletion} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
