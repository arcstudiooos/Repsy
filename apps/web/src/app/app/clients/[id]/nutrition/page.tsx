import type { Metadata } from 'next';
import Link from 'next/link';
import { clientMealPlan, getNutrition, listMealPlans, TRAINER_ROLES } from '@kinetic/core';
import { MealPlanDisplay } from '@/components/nutrition/MealPlanDisplay';
import { MealPlanPicker } from '@/components/nutrition/MealPlanPicker';
import { NutritionPanel } from '@/components/nutrition/NutritionPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { withServerTenant } from '@/server/serverActor';
import { loadClient } from '../data';

export const metadata: Metadata = { title: 'Nutrition | Kinetic' };

/** A client's nutrition targets and daily totals (PRD G6/G7), and their meal plan (G8). */
export default async function ClientNutritionPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await loadClient((await params).id);
  const { view, plan, plans, canEdit } = await withServerTenant(async (tx, actor) => {
    const canEdit = (TRAINER_ROLES as readonly string[]).includes(actor.role);
    return {
      view: await getNutrition(tx, actor, client.id),
      plan: await clientMealPlan(tx, actor, client.id),
      plans: canEdit ? await listMealPlans(tx, actor) : [],
      canEdit,
    };
  });
  return (
    <div className="flex flex-col gap-8">
      <NutritionPanel clientId={client.id} view={view} isCoach />
      <Card>
        <CardHeader>
          <CardTitle as="h2">{plan ? `Meal plan: ${plan.plan.title}` : 'Meal plan'}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {canEdit &&
            client.status !== 'archived' &&
            (plans.length > 0 ? (
              <MealPlanPicker
                clientId={client.id}
                current={plan?.plan.id ?? null}
                plans={plans.map((p) => ({ id: p.id, title: p.title }))}
              />
            ) : (
              <p className="text-secondary">
                <Link href="/app/meal-plans" className="text-accent underline underline-offset-4">
                  Build a meal plan
                </Link>{' '}
                to give this client one.
              </p>
            ))}
          {plan ? (
            <MealPlanDisplay
              plan={plan.plan}
              shopping={[]}
              recipeHref={(id) => `/app/meal-plans/recipes/${id}`}
            />
          ) : (
            !canEdit && <p className="text-secondary">No meal plan.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
