import type { Metadata } from 'next';
import Link from 'next/link';
import { getAssignmentSummary, listPhases } from '@kinetic/core';
import { EmptyState } from '@/components/states/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatWeekdays } from '@/lib/assign-form';
import { loadAllTemplates } from '@/server/selectOptions';
import { withServerTenant } from '@/server/serverActor';
import { formatDate } from '../../StatusBadge';
import { loadClient } from '../data';
import { AssignDialog } from './AssignDialog';
import { PhaseQueue } from './PhaseQueue';

export const metadata: Metadata = { title: 'Program | Repsy' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function ClientProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const { summary, templates, capped, phases } = await withServerTenant(async (tx, actor) => {
    const all = await loadAllTemplates(tx, actor);
    return {
      summary: await getAssignmentSummary(tx, actor, client.id),
      phases: await listPhases(tx, actor, client.id),
      capped: all.capped,
      templates: all.items.flatMap((p) =>
        p.versionNo !== null && p.daysPerWeek
          ? [{ id: p.id, title: p.title, daysPerWeek: p.daysPerWeek }]
          : [],
      ),
    };
  });

  const dialog = (label: string, variant: 'default' | 'secondary', hasActive: boolean) => (
    <AssignDialog
      fixed="client"
      templates={templates}
      clients={[{ id: client.id, name: client.name, timezone: client.timezone }]}
      hasActive={hasActive}
      capped={capped}
      triggerLabel={label}
      triggerVariant={variant}
    />
  );

  if (!summary) {
    if (client.status !== 'active') {
      return (
        <EmptyState
          title="No program yet"
          body="You can assign a program once this client has accepted their invite."
        />
      );
    }
    if (templates.length === 0) {
      return (
        <EmptyState
          title="No program yet"
          body="Save a program template first, then assign it here."
          action={
            <Link href="/app/programs" className={buttonVariants({ variant: 'secondary' })}>
              Go to Programs
            </Link>
          }
        />
      );
    }
    return (
      <EmptyState
        title="No program yet"
        body="Assign a saved program to schedule this client's workouts."
        action={dialog('Assign a program', 'default', false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Current program</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-secondary">Program</dt>
              <dd className="break-words">{summary.programTitle}</dd>
            </div>
            <div>
              <dt className="text-sm text-secondary">Start date</dt>
              <dd>{formatDate(summary.startLocalDate)}</dd>
            </div>
            <div>
              <dt className="text-sm text-secondary">Training days</dt>
              <dd>{formatWeekdays(summary.weekdays)}</dd>
            </div>
            <div>
              <dt className="text-sm text-secondary">Sessions</dt>
              <dd>{plural(summary.sessionCount, 'session', 'sessions')}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-secondary">Next session</dt>
              <dd className="break-words">
                {summary.nextSession
                  ? `${formatDate(summary.nextSession.localDate)} · ${summary.nextSession.title}`
                  : 'No upcoming sessions'}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/app/programs/${summary.programId}/edit`}
              className={buttonVariants({ variant: 'default' })}
            >
              Edit program
            </Link>
            <Link
              href={`/app/programs/${summary.programId}/history`}
              className={buttonVariants({ variant: 'secondary' })}
            >
              Version history
            </Link>
            {templates.length > 0 && dialog('Change program', 'secondary', true)}
          </div>
        </CardContent>
      </Card>
      <PhaseQueue
        clientId={client.id}
        phases={phases}
        templates={templates.map((t) => ({ id: t.id, title: t.title }))}
      />
    </div>
  );
}
