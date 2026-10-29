import { cache } from 'react';
import { notFound } from 'next/navigation';
import { DomainError, getClient, type ClientView } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';

/** One lookup per request, shared by the layout and the page. Unknown or cross-tenant ids are a 404. */
export const loadClient = cache(async (id: string): Promise<ClientView> => {
  try {
    return await withServerTenant((tx, actor) => getClient(tx, actor, id));
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
});
