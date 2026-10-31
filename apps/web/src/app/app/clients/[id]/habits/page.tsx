import type { Metadata } from 'next';
import { listHabits } from '@kinetic/core';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';
import { HabitsManager } from './HabitsManager';

export const metadata: Metadata = { title: 'Habits | Kinetic' };

/** A client's habits and tasks (PRD G1-G3). */
export default async function ClientHabitsPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const view = await withServerTenant((tx, actor) => listHabits(tx, actor, client.id));
  return <HabitsManager clientId={client.id} view={view} />;
}
