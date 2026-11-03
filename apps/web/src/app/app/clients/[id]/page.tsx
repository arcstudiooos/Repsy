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
} from '@kinetic/core';
import { CompliancePercent, WINDOW_LABEL } from '@/components/analytics/Compliance';
import { EngagementCard } from '@/components/analytics/Engagement';
import { GoalsPanel } from '@/components/goals/GoalsPanel';
import { DeletionRequestButton } from '@/components/settings/DeletionRequestButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';
import { formatDate } from '../StatusBadge';
import { loadClient } from './data';
import { AgreementStatus } from './AgreementStatus';
import { InviteControls } from './InviteControls';
import { TagEditor } from './TagEditor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Client | Repsy' };

export default async function ClientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
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
  }));
  const joined = client.joinedAt ? client.joinedAt.slice(0, 10) : null;
  const rows: [string, string][] = [
    ['Email', client.email],
    ['Start date', formatDate(client.startDate)],
    ['Time zone', client.timezone],
    ['Units', client.preferredUnits],
  ];
  if (joined) rows.push(['Joined', formatDate(joined)]);
  const adherence = compliance && (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Adherence</CardTitle>
        <CardDescription>
          Completed of due workouts, ending today in the client&apos;s time zone. Paused and
          cancelled workouts are left out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-3 divide-x divide-divider overflow-hidden rounded-control border border-divider">
          {COMPLIANCE_WINDOWS.map((days) => {
            const c = compliance[days];
            return (
              <div key={days} className="p-3 sm:p-4">
                <dt className="text-sm text-secondary">Last {WINDOW_LABEL[days]}</dt>
                <dd className="mt-1 text-lg font-semibold sm:text-2xl">
                  <CompliancePercent counts={c} />
                </dd>
                {c.eligible > 0 && (
                  <dd className="mt-1 hidden text-xs text-secondary sm:block">
                    {c.skipped} skipped · {c.incomplete} not finished · {c.missed} missed
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
  return (
    <div className="flex flex-col gap-6">
      {client.status === 'invited' && client.inviteStatus !== 'accepted' && (
        <Card className="border-accent/20 bg-accent-soft/50">
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {adherence}
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
          <Card className="sm:p-5">
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col divide-y divide-divider text-sm">
                {rows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                    <dt className="text-secondary">{label}</dt>
                    <dd className="text-right break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card className="sm:p-5">
            <CardHeader>
              <CardTitle as="h2" className="text-base">
                Tags
              </CardTitle>
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
            <Card className="sm:p-5">
              <CardHeader>
                <CardTitle className="text-base">Data</CardTitle>
                <CardDescription>
                  Ask Repsy to delete this client&apos;s data. The request is verified before
                  anything is deleted.
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
