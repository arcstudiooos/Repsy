import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '../StatusBadge';
import { loadClient } from './data';
import { InviteControls } from './InviteControls';

export const metadata: Metadata = { title: 'Client | Kinetic' };

export default async function ClientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
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
            <div className="sm:col-span-2">
              <dt className="text-sm text-secondary">Goals</dt>
              <dd className="whitespace-pre-wrap">{client.goals ?? 'No goals added yet.'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
