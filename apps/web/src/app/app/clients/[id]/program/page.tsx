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
import { connection } from 'next/server';
import { bucketOf } from '@kinetic/core';
import { STATE_COLOR, STATE_LABEL } from '@/components/charts/palette';
import { Section } from '@/components/ui/section';

export const metadata: Metadata = { title: 'Program | Repsy' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The clock, read per request (the page already reads request data). */
async function requestNowMs() {
  await connection();
  return Date.now();
}

export default async function ClientProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const { summary, templates, capped, phases, grid, graceMs } = await withServerTenant(
    async (tx, actor) => {
      const all = await loadAllTemplates(tx, actor);
      const summary = await getAssignmentSummary(tx, actor, client.id);
      // The week × day overview: every planned session of the active assignment by its slot.
      const grid = summary
        ? await tx.workoutSession.findMany({
            where: { assignmentId: summary.assignmentId, state: { not: 'cancelled' } },
            orderBy: [{ slotWeekIndex: 'asc' }, { slotDayIndex: 'asc' }],
            select: {
              id: true,
              slotWeekIndex: true,
              slotDayIndex: true,
              state: true,
              scheduledLocalDate: true,
              dueAt: true,
              workoutVersion: { select: { title: true } },
            },
          })
        : [];
      const graceHours =
        (await tx.organization.findFirst({ select: { graceHours: true } }))?.graceHours ?? 24;
      return {
        grid,
        graceMs: graceHours * 3_600_000,
        summary,
        phases: await listPhases(tx, actor, client.id),
        capped: all.capped,
        templates: all.items.flatMap((p) =>
          p.versionNo !== null && p.daysPerWeek
            ? [{ id: p.id, title: p.title, daysPerWeek: p.daysPerWeek }]
            : [],
        ),
      };
    },
  );

  const nowMs = await requestNowMs();
  const weeks = [...new Set(grid.map((g) => g.slotWeekIndex ?? 0))].sort((a, b) => a - b);
  const days = [...new Set(grid.map((g) => g.slotDayIndex ?? 0))].sort((a, b) => a - b);

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
      {grid.length > 0 && (
        <Section
          title="Program overview"
          description="Every workout by week and training day, coloured by how it went."
        >
          <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-e1">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Program overview by week and training day</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="label-micro px-3 py-2 text-secondary">
                    Week
                  </th>
                  {days.map((d) => (
                    <th key={d} scope="col" className="label-micro px-3 py-2 text-secondary">
                      Day {d + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w} className="border-t border-border">
                    <th scope="row" className="px-3 py-2 font-medium">
                      {w + 1}
                    </th>
                    {days.map((d) => {
                      const cell = grid.find((g) => g.slotWeekIndex === w && g.slotDayIndex === d);
                      if (!cell)
                        return (
                          <td key={d} className="px-3 py-2 text-secondary">
                            –
                          </td>
                        );
                      const b = bucketOf(cell.state, cell.dueAt.getTime() < nowMs - graceMs);
                      return (
                        <td key={d} className="px-2 py-2">
                          <Link
                            href={`/app/clients/${client.id}/sessions/${cell.id}`}
                            className="flex flex-col gap-1 rounded-md border-l-4 bg-surface-2 px-2 py-1.5 hover:bg-accent-soft"
                            style={{ borderLeftColor: b ? STATE_COLOR[b] : 'var(--k-border)' }}
                          >
                            <span className="font-medium break-words">
                              {cell.workoutVersion?.title ?? `Day ${d + 1}`}
                            </span>
                            <span className="text-caption text-secondary">
                              {formatDate(cell.scheduledLocalDate.toISOString().slice(0, 10))} ·{' '}
                              {b ? STATE_LABEL[b] : 'Cancelled'}
                            </span>
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <PhaseQueue
        clientId={client.id}
        phases={phases}
        templates={templates.map((t) => ({ id: t.id, title: t.title }))}
      />
    </div>
  );
}
