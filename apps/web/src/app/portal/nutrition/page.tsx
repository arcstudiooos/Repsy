import type { Metadata } from 'next';
import Link from 'next/link';
import { clientMealPlan, getNutrition } from '@kinetic/core';
import { NutritionPanel } from '@/components/nutrition/NutritionPanel';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { withPortalTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Nutrition | Kinetic' };

/** The client's own nutrition targets and daily totals (PRD G6/G7), and a way to their meal plan (G8). */
export default async function PortalNutritionPage() {
  const { clientId, view, plan } = await withPortalTenant(async (tx, actor) => ({
    clientId: actor.clientId as string,
    view: await getNutrition(tx, actor, actor.clientId as string),
    plan: await clientMealPlan(tx, actor),
  }));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold md:text-3xl">Nutrition</h1>
      {plan && (
        <Link
          href="/portal/meals"
          className={cn(buttonVariants({ variant: 'secondary' }), 'mb-6 min-h-12 w-full')}
        >
          Your meal plan: {plan.plan.title}
        </Link>
      )}
      <NutritionPanel clientId={clientId} view={view} isCoach={false} />
    </>
  );
}
