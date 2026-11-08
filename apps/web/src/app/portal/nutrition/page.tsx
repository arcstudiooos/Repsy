import type { Metadata } from 'next';
import Link from 'next/link';
import { clientMealPlan, getNutrition } from '@repsy/core';
import { NutritionPanel } from '@/components/nutrition/NutritionPanel';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { withPortalTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'Nutrition | Repsy' };

/** The client's own nutrition targets and daily totals (PRD G6/G7), and a way to their meal plan (G8). */
export default async function PortalNutritionPage() {
  const { clientId, view, plan } = await withPortalTenant(async (tx, actor) => ({
    clientId: actor.clientId as string,
    view: await getNutrition(tx, actor, actor.clientId as string),
    plan: await clientMealPlan(tx, actor),
  }));
  return (
    <>
      <h1 className="mb-6 text-h1 font-semibold md:text-display">Nutrition</h1>
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
