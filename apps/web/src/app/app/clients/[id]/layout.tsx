import type { ReactNode } from 'react';
import { Breadcrumbs } from '@/components/nav/Breadcrumbs';
import { StatusBadge } from '../StatusBadge';
import { ClientTabs } from './ClientTabs';
import { loadClient } from './data';

export default async function ClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await loadClient(id);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Clients', href: '/app/clients' }, { label: client.name }]} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">{client.name}</h1>
        <StatusBadge status={client.status} />
      </div>
      <div className="flex flex-col gap-6">
        <ClientTabs clientId={client.id} />
        {children}
      </div>
    </>
  );
}
