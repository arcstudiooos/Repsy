import type { ReactNode } from 'react';
import { getClientContext } from '@kinetic/core';
import { Breadcrumbs } from '@/components/nav/Breadcrumbs';
import { withServerTenant } from '@/server/serverActor';
import { StatusBadge } from '../StatusBadge';
import { ClientTabs } from './ClientTabs';
import { ContextCard } from './ContextCard';
import { loadClient } from './data';
import { PauseControls } from './PauseControls';

export default async function ClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadClient(id);
  const context = await withServerTenant((tx, actor) => getClientContext(tx, actor, client.id));
  return (
    <>
      <Breadcrumbs items={[{ label: 'Clients', href: '/app/clients' }, { label: client.name }]} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">{client.name}</h1>
        <StatusBadge status={client.status} />
      </div>
      <div className="mb-4">
        <PauseControls client={client} />
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
