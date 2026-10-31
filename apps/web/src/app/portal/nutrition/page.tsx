import type { Metadata } from 'next';
import { getNutrition } from '@kinetic/core';
import { NutritionPanel } from '@/components/nutrition/NutritionPanel';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Nutrition | Kinetic' };

/** The client's own nutrition targets and daily totals (PRD G6/G7). */
export default async function PortalNutritionPage() {
  const { clientId, view } = await withPortalTenant(async (tx, actor) => ({
    clientId: actor.clientId as string,
    view: await getNutrition(tx, actor, actor.clientId as string),
  }));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Nutrition</h1>
      <NutritionPanel clientId={clientId} view={view} isCoach={false} />
    </>
  );
}
