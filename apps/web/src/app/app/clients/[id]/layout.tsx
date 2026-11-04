import type { ReactNode } from 'react';
import { getClientContext, isManager, TRAINER_ROLES } from '@kinetic/core';
import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import { Breadcrumbs } from '@/components/nav/Breadcrumbs';
import { Avatar } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { withServerTenant } from '@/server/serverActor';
import { StatusBadge } from '../StatusBadge';
import { ClientTabs } from './ClientTabs';
import { ContextCard } from './ContextCard';
import { loadClient } from './data';
import { EndCoaching } from './EndCoaching';
import { PauseControls } from './PauseControls';
import { CoachSelect } from './CoachSelect';
import { StageSelect } from './StageSelect';

export default async function ClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadClient(id);
  const { context, coaches, canTransfer, canEdit, plan } = await withServerTenant(
    async (tx, actor) => ({
      context: await getClientContext(tx, actor, client.id),
      // PRD A11: the team's coaches, to move the client to another.
      coaches: (
        await tx.membership.findMany({
          where: { status: 'active', role: { in: [...TRAINER_ROLES] } },
          orderBy: { createdAt: 'asc' },
          select: { userId: true, user: { select: { name: true } } },
        })
      ).map((m) => ({ userId: m.userId, name: m.user.name })),
      canTransfer:
        isManager(actor.role) || (actor.role === 'coach' && actor.userId === client.coachUserId),
      canEdit: (TRAINER_ROLES as readonly string[]).includes(actor.role),
      // The hero's program line: title and "Week X of Y" from the active assignment's sessions.
      plan: await (async () => {
        const a = await tx.programAssignment.findFirst({
          where: { clientId: client.id, status: 'active' },
          select: { id: true, program: { select: { title: true } } },
        });
        if (!a) return null;
        const weeks = await tx.workoutSession.groupBy({
          by: ['slotWeekIndex'],
          where: { assignmentId: a.id, state: { not: 'cancelled' }, slotWeekIndex: { not: null } },
        });
        const next = await tx.workoutSession.findFirst({
          where: { assignmentId: a.id, state: { in: ['scheduled', 'in_progress'] } },
          orderBy: [{ dueAt: 'asc' }],
          select: { slotWeekIndex: true },
        });
        const total = weeks.length;
        const current = next?.slotWeekIndex != null ? next.slotWeekIndex + 1 : total;
        return {
          title: a.program.title,
          week: Math.min(Math.max(current, 1), Math.max(total, 1)),
          total,
        };
      })(),
    }),
  );
  return (
    <>
      <Breadcrumbs items={[{ label: 'Clients', href: '/app/clients' }, { label: client.name }]} />
      <section
        aria-label="Client summary"
        className="mb-6 rounded-xl border border-border bg-surface p-4 shadow-e1 sm:p-6"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar name={client.name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-h1 font-semibold break-words">{client.name}</h1>
                <StatusBadge status={client.status} />
              </div>
              <p className="mt-0.5 text-sm break-all text-secondary">{client.email}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <StageSelect clientId={client.id} stage={client.lifecycleStage} />
                {coaches.length > 1 && (
                  <CoachSelect
                    clientId={client.id}
                    coachUserId={client.coachUserId}
                    coaches={coaches}
                    canTransfer={canTransfer}
                  />
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap items-start gap-2 lg:justify-end">
              <Link
                href={`/app/clients/${client.id}/messages`}
                className={buttonVariants({ variant: 'soft' })}
              >
                <MessageSquare aria-hidden />
                Message
              </Link>
              <PauseControls client={client} />
              {canEdit && <EndCoaching client={client} />}
            </div>
          </div>
        </div>
        {plan && (
          <div className="mt-5 flex flex-col gap-2 rounded-md bg-surface-2 p-3 sm:flex-row sm:items-center sm:gap-4">
            <p className="text-sm">
              <span className="text-secondary">Program </span>
              <span className="font-medium">{plan.title}</span>
            </p>
            {plan.total > 0 && (
              <div className="flex flex-1 items-center gap-3">
                <Progress
                  value={plan.week}
                  max={plan.total}
                  label="Program progress"
                  valueText={`Week ${plan.week} of ${plan.total}`}
                />
                <span className="tabular shrink-0 text-sm font-medium">
                  Week {plan.week} of {plan.total}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="mt-5 border-t border-border pt-5">
          <ContextCard context={context} />
        </div>
      </section>
      <div className="flex flex-col gap-6">
        <ClientTabs clientId={client.id} />
        {children}
      </div>
    </>
  );
}
