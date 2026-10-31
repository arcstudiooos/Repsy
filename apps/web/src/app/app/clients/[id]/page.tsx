import type { Metadata } from 'next';
import {
  clientCompliance,
  COMPLIANCE_WINDOWS,
  deletionStatusFor,
  listTags,
  tagsForClients,
} from '@kinetic/core';
import { CompliancePercent, WINDOW_LABEL } from '@/components/analytics/Compliance';
import { DeletionRequestButton } from '@/components/settings/DeletionRequestButton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';
import { formatDate } from '../StatusBadge';
import { loadClient } from './data';
import { InviteControls } from './InviteControls';
import { TagEditor } from './TagEditor';

export const metadata: Metadata = { title: 'Client | Kinetic' };

export default async function ClientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const { isOwner, deletion, compliance, allTags, clientTags } = await withServerTenant(
    async (tx, actor) => ({
      isOwner: actor.role === 'owner',
      deletion: await deletionStatusFor(tx, actor, client.id),
      compliance: (await clientCompliance(tx, actor, [client.id])).get(client.id) ?? null,
      allTags: await listTags(tx, actor),
      clientTags: (await tagsForClients(tx, actor, [client.id])).get(client.id) ?? [],
    }),
  );
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
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-secondary">{label}</dt>
                <dd className="break-all">{value}</dd>
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
            <dl className="grid gap-4 sm:grid-cols-3">
              {COMPLIANCE_WINDOWS.map((days) => {
                const c = compliance[days];
                return (
                  <div key={days}>
                    <dt className="text-sm text-secondary">Last {WINDOW_LABEL[days]}</dt>
                    <dd className="text-lg font-semibold">
                      <CompliancePercent counts={c} />
                    </dd>
                    {c.eligible > 0 && (
                      <dd className="text-sm text-secondary">
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
      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Data</CardTitle>
          </CardHeader>
          <CardContent>
            <DeletionRequestButton clientId={client.id} current={deletion} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
