import type { Metadata } from 'next';
import { getNutrition } from '@kinetic/core';
import { NutritionPanel } from '@/components/nutrition/NutritionPanel';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

export const metadata: Metadata = { title: 'Nutrition | Kinetic' };

/** A client's nutrition targets and daily totals (PRD G6/G7). */
export default async function ClientNutritionPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const view = await withServerTenant((tx, actor) => getNutrition(tx, actor, client.id));
  return <NutritionPanel clientId={client.id} view={view} isCoach />;
}
