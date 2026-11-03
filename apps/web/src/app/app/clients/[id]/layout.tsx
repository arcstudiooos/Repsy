import type { ReactNode } from 'react';
import { getClientContext, isManager, TRAINER_ROLES } from '@kinetic/core';
import { Breadcrumbs } from '@/components/nav/Breadcrumbs';
import { withServerTenant } from '@/server/serverActor';
import { StatusBadge } from '../StatusBadge';
import { ClientTabs } from './ClientTabs';
import { ContextCard } from './ContextCard';
import { loadClient } from './data';
import { EndCoaching } from './EndCoaching';
import { PauseControls } from './PauseControls';
import { CoachSelect } from './CoachSelect';
import { StageSelect } from './StageSelect';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export default async function ClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadClient(id);
  const { context, coaches, canTransfer, canEdit } = await withServerTenant(async (tx, actor) => ({
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
  }));
  return (
    <>
      <Breadcrumbs items={[{ label: 'Clients', href: '/app/clients' }, { label: client.name }]} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">{client.name}</h1>
        <StatusBadge status={client.status} />
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
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <PauseControls client={client} />
        {canEdit && <EndCoaching client={client} />}
      </div>
      <div className="mb-4">
        <ContextCard context={context} />
      </div>
      <div className="flex flex-col gap-6">
        <ClientTabs clientId={client.id} />
        {children}
      </div>
    </>
  );
}
