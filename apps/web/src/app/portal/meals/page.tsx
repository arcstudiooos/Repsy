import type { Metadata } from 'next';
import { clientMealPlan } from '@kinetic/core';
import { MealPlanDisplay } from '@/components/nutrition/MealPlanDisplay';
import { EmptyState } from '@/components/states/EmptyState';
import { withPortalTenant } from '@/server/serverActor';

// May block on request data (session, params); opts out of Next instant-navigation validation, see HANDOFF.
export const instant = false;

export const metadata: Metadata = { title: 'Meal plan | Kinetic' };

/** PRD G8: the client's meal plan, its recipes and a shopping list. */
export default async function PortalMealsPage() {
  const mine = await withPortalTenant((tx, actor) => clientMealPlan(tx, actor));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold break-words md:text-3xl">
        {mine ? mine.plan.title : 'Meal plan'}
      </h1>
      {mine ? (
        <MealPlanDisplay
          plan={mine.plan}
          shopping={mine.shopping}
          recipeHref={(id) => `/portal/meals/recipes/${id}`}
        />
      ) : (
        <EmptyState
          title="No meal plan yet"
          body="When your coach gives you a meal plan, it appears here with a shopping list."
        />
      )}
    </>
  );
}
